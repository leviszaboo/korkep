import type { ArticleAnalysis } from '@korkep/shared';
import { TOPICS } from '@korkep/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// Rate limiter for Google AI Studio (15 req/min, 1500 req/day free tier)
// ---------------------------------------------------------------------------

const REDIS_KEY_MINUTE = 'gemini:rate:minute';
const REDIS_KEY_DAY = 'gemini:rate:day';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redis.url, { maxRetriesPerRequest: 3, lazyConnect: true });
    redis.connect().catch((err: unknown) => logger.error({ err }, 'Rate limiter Redis connection failed'));
  }
  return redis;
}

async function acquireRateSlot(): Promise<'ok' | 'daily_exhausted'> {
  const r = getRedis();
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = 60;

  const dailyCount = await r.get(REDIS_KEY_DAY);
  if (dailyCount && parseInt(dailyCount, 10) >= config.googleAiStudio.maxPerDay) {
    return 'daily_exhausted';
  }

  // Sliding window per-minute check using a sorted set
  const pipe = r.pipeline();
  pipe.zremrangebyscore(REDIS_KEY_MINUTE, 0, now - minuteWindow);
  pipe.zcard(REDIS_KEY_MINUTE);
  const results = await pipe.exec();
  const currentCount = (results?.[1]?.[1] as number) ?? 0;

  if (currentCount >= config.googleAiStudio.maxPerMinute) {
    const oldest = await r.zrangebyscore(REDIS_KEY_MINUTE, '-inf', '+inf', 'LIMIT', 0, 1);
    const oldestTs = oldest.length > 0 ? parseInt(oldest[0], 10) : now;
    const waitMs = Math.max((oldestTs + minuteWindow - now) * 1000, 1000);
    logger.info({ waitMs, currentCount }, 'Gemini rate limit reached, waiting');
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    await r.zremrangebyscore(REDIS_KEY_MINUTE, 0, Math.floor(Date.now() / 1000) - minuteWindow);
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await r.zadd(REDIS_KEY_MINUTE, now, id);
  await r.expire(REDIS_KEY_MINUTE, minuteWindow + 5);

  const newDaily = await r.incr(REDIS_KEY_DAY);
  if (newDaily === 1) {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const ttl = Math.ceil((midnight.getTime() - Date.now()) / 1000);
    await r.expire(REDIS_KEY_DAY, ttl);
  }

  return 'ok';
}

// ---------------------------------------------------------------------------
// Shared prompt logic
// ---------------------------------------------------------------------------

interface OpenRouterChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: Array<{ text: string }> };
  }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

const MAX_RETRIES = 2;
const MAX_INPUT_CHARS = 2000;

const TOPICS_LIST = TOPICS.join(', ');

const SYSTEM_PROMPT = `Egy magyar hírösszefoglaló és -elemző rendszer vagy. A feladatod a cikk strukturált elemzése.

Válaszolj KIZÁRÓLAG az alábbi JSON formátumban, semmilyen más szöveget ne írj:
{
  "summary": "2-3 mondatos tömör, tényszerű, semleges összefoglaló (max 150 szó)",
  "headline": "Semleges, forrásfüggetlen főcím (max 15 szó)",
  "mainEvent": "Egy mondatban: mi történt / miről szól a cikk",
  "location": "Helyszín (város/ország/régió) vagy null ha nem releváns",
  "entities": ["Legfontosabb személyek, szervezetek, intézmények (max 5)"],
  "topics": ["Témakörök az alábbi listából (1-3): ${TOPICS_LIST}"]
}

A topics mező KIZÁRÓLAG az alábbi értékeket tartalmazhatja: ${TOPICS_LIST}`;

function buildUserPrompt(title: string, body: string | null, lead: string | null): string {
  const parts: string[] = [`Cím: ${title}`];
  if (lead) parts.push(`Lead: ${lead}`);
  if (body) {
    const truncated = body.slice(0, MAX_INPUT_CHARS);
    parts.push(`Szöveg: ${truncated}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Google AI Studio (Gemini native API)
// ---------------------------------------------------------------------------

async function callGeminiNative(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const body: Record<string, unknown> = {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
          ...(jsonMode && { responseMimeType: 'application/json' }),
        },
      };

      const model = config.googleAiStudio.model;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.googleAiStudio.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new Error(`Gemini API returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) {
        throw new Error('Empty response from Gemini API');
      }

      if (data.usageMetadata) {
        logger.debug(
          { promptTokens: data.usageMetadata.promptTokenCount, completionTokens: data.usageMetadata.candidatesTokenCount },
          'Gemini token usage',
        );
      }

      return content;
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt: attempt + 1 }, 'Gemini call failed, retrying');
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// OpenRouter API (OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callOpenRouterChat(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
  model?: string,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const body: Record<string, unknown> = {
        model: model ?? config.summarizer.openrouterModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 500,
      };
      if (jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openrouter.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new Error(`OpenRouter chat returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OpenRouterChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenRouter chat');
      }

      if ((data as any).usage) {
        logger.debug(
          { promptTokens: (data as any).usage.prompt_tokens, completionTokens: (data as any).usage.completion_tokens },
          'OpenRouter token usage',
        );
      }

      return content;
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt: attempt + 1 }, 'OpenRouter call failed, retrying');
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const VALID_TOPICS = new Set<string>(TOPICS);

function parseAnalysisResponse(raw: string): ArticleAnalysis {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in response');
  }
  const parsed = JSON.parse(jsonMatch[0]);

  if (!parsed.summary || !parsed.headline || !parsed.mainEvent) {
    throw new Error('Missing required fields in response');
  }

  const entities = Array.isArray(parsed.entities)
    ? parsed.entities.map(String).slice(0, 5)
    : [];

  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map(String).filter((t: string) => VALID_TOPICS.has(t)).slice(0, 3)
    : [];

  return {
    summary: String(parsed.summary).trim(),
    headline: String(parsed.headline).trim(),
    mainEvent: String(parsed.mainEvent).trim(),
    location: parsed.location ? String(parsed.location).trim() : null,
    entities,
    topics,
  };
}

// ---------------------------------------------------------------------------
// Public API — article analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an article using Google AI Studio (rate-limited, free tier).
 * Falls back to OpenRouter if the daily Gemini quota is exhausted
 * or if no Google AI Studio API key is configured.
 */
export async function analyzeArticle(
  title: string,
  body: string | null,
  lead: string | null,
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.debug({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    let raw: string;

    if (config.googleAiStudio.apiKey) {
      const slot = await acquireRateSlot();
      if (slot === 'ok') {
        raw = await callGeminiNative(SYSTEM_PROMPT, userPrompt, true);
      } else {
        logger.info('Gemini daily limit exhausted, falling back to OpenRouter');
        raw = await callOpenRouterChat(SYSTEM_PROMPT, userPrompt, true);
      }
    } else {
      raw = await callOpenRouterChat(SYSTEM_PROMPT, userPrompt, true);
    }

    return parseAnalysisResponse(raw);
  } catch (err) {
    logger.error({ err, title }, 'Article analysis failed');
    return null;
  }
}

/**
 * Analyze an article explicitly via OpenRouter (no rate limiting).
 * Used by resummarize and other batch operations where speed matters.
 */
export async function analyzeArticleViaOpenRouter(
  title: string,
  body: string | null,
  lead: string | null,
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.debug({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    const raw = await callOpenRouterChat(SYSTEM_PROMPT, userPrompt, true);
    return parseAnalysisResponse(raw);
  } catch (err) {
    logger.error({ err, title }, 'Article analysis failed (OpenRouter)');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Story title / summary generation (always via OpenRouter)
// ---------------------------------------------------------------------------

function extractPlainText(raw: string): string {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/^[\[{][\s\S]*[\]}]$/);
  if (jsonMatch) {
    try {
      let parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) parsed = parsed[0];
      if (parsed && typeof parsed === 'object') {
        const value = parsed.title ?? parsed.headline ?? parsed.summary ?? parsed.text ?? Object.values(parsed)[0];
        if (typeof value === 'string') return value.trim();
      }
      if (typeof parsed === 'string') return parsed.trim();
    } catch {}
  }
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

export async function generateStoryTitle(articleTitles: string[]): Promise<string | null> {
  if (articleTitles.length === 0) return null;
  if (articleTitles.length === 1) return null;

  const prompt = `Az alábbi magyar hírforrásokból származó cikkek ugyanarról az eseményről/történetről szólnak.
Írj egy semleges, tömör főcímet, amely összefoglalja a történetet (max 15 szó).
A főcím ne favorizáljon egyetlen forrást sem, legyen tényszerű.

Válaszolj KIZÁRÓLAG a főcímmel, semmilyen más szöveget ne írj.

Cikkek:
${articleTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  try {
    const raw = await callOpenRouterChat(
      'Egy magyar hírösszefoglaló rendszer vagy. A válaszod legyen KIZÁRÓLAG a kért főcím, semmilyen más szöveg.',
      prompt,
    );
    return extractPlainText(raw) || null;
  } catch (err) {
    logger.error({ err }, 'Story title generation failed');
    return null;
  }
}

export async function generateStorySummary(
  articleSummaries: string[],
  storyTitle: string,
): Promise<string | null> {
  if (articleSummaries.length === 0) return null;
  if (articleSummaries.length === 1) return extractPlainText(articleSummaries[0]);

  const prompt = `Az alábbi összefoglalók ugyanarról a történetről szólnak: "${storyTitle}"

Írj egy semleges, tényszerű, 2-3 mondatos összefoglalót, amely szintetizálja a különböző forrásokból származó információkat.
Válaszolj KIZÁRÓLAG az összefoglalóval, semmilyen más szöveget ne írj.

Összefoglalók:
${articleSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  try {
    const raw = await callOpenRouterChat(
      'Egy magyar hírösszefoglaló rendszer vagy. A válaszod legyen KIZÁRÓLAG a kért összefoglaló, semmilyen más szöveg.',
      prompt,
    );
    return extractPlainText(raw) || null;
  } catch (err) {
    logger.error({ err }, 'Story summary generation failed');
    return null;
  }
}
