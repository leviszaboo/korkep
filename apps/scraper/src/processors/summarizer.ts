import type { ArticleAnalysis } from '@korkep/shared';
import { TOPICS } from '@korkep/shared';
import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { logLlmUsage, type LlmActivity } from '../lib/llm-usage.js';

import { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// SDK clients
// ---------------------------------------------------------------------------

const gemini = config.googleAiStudio.apiKey
  ? new GoogleGenAI({ apiKey: config.googleAiStudio.apiKey })
  : null;

const openrouter = new OpenRouter({ apiKey: config.openrouter.apiKey });

// ---------------------------------------------------------------------------
// Rate limiter for Google AI Studio (15 req/min, 1500 req/day free tier)
// Uses Redis when available (local dev), falls back to in-memory (Cloud Run).
// In-memory daily counter resets each job run — Gemini's server-side 429
// plus the OpenRouter fallback handle overflow gracefully.
// ---------------------------------------------------------------------------

const REDIS_KEY_MINUTE = 'gemini:rate:minute';
const REDIS_KEY_DAY = 'gemini:rate:day';

let redisInstance: Redis | null = null;
let redisAvailable: boolean | null = null;

async function tryGetRedis(): Promise<Redis | null> {
  if (redisAvailable === false) return null;
  if (redisInstance) return redisInstance;
  if (!config.redis.url) { redisAvailable = false; return null; }

  try {
    const r = new Redis(config.redis.url, { maxRetriesPerRequest: 3, lazyConnect: true });
    await r.connect();
    redisInstance = r;
    redisAvailable = true;
    return r;
  } catch {
    logger.info('Redis not available, using in-memory rate limiter');
    redisAvailable = false;
    return null;
  }
}

// In-memory state (used when Redis is unavailable)
const memTimestamps: number[] = [];
let memDailyCount = 0;

async function acquireRateSlot(): Promise<'ok' | 'daily_exhausted'> {
  const r = await tryGetRedis();
  if (r) return acquireRateSlotRedis(r);
  return acquireRateSlotMemory();
}

async function acquireRateSlotMemory(): Promise<'ok' | 'daily_exhausted'> {
  if (memDailyCount >= config.googleAiStudio.maxPerDay) return 'daily_exhausted';

  const now = Math.floor(Date.now() / 1000);
  while (memTimestamps.length > 0 && memTimestamps[0] <= now - 60) memTimestamps.shift();

  if (memTimestamps.length >= config.googleAiStudio.maxPerMinute) {
    const waitMs = Math.max((memTimestamps[0] + 60 - now) * 1000, 1000);
    logger.info({ waitMs, currentCount: memTimestamps.length }, 'Gemini rate limit reached, waiting');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    while (memTimestamps.length > 0 && memTimestamps[0] <= Math.floor(Date.now() / 1000) - 60) memTimestamps.shift();
  }

  memTimestamps.push(Math.floor(Date.now() / 1000));
  memDailyCount++;
  return 'ok';
}

async function acquireRateSlotRedis(r: Redis): Promise<'ok' | 'daily_exhausted'> {
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = 60;

  const dailyCount = await r.get(REDIS_KEY_DAY);
  if (dailyCount && parseInt(dailyCount, 10) >= config.googleAiStudio.maxPerDay) {
    return 'daily_exhausted';
  }

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

const MAX_RETRIES = 2;
const MAX_INPUT_CHARS = 2000;

const TOPICS_LIST = TOPICS.join(', ');

const SYSTEM_PROMPT = `Egy magyar hírösszefoglaló és -elemző rendszer vagy. A feladatod a cikk strukturált elemzése KLASZTEREZÉS céljából.

Válaszolj KIZÁRÓLAG az alábbi JSON formátumban, semmilyen más szöveget ne írj:
{
  "summary": "2-3 mondatos tömör, tényszerű, semleges összefoglaló (max 150 szó)",
  "headline": "Semleges, forrásfüggetlen főcím (max 15 szó)",
  "mainEvent": "Egy mondatban: mi történt / miről szól a cikk",
  "storyIdentity": "Egy mondat, ami EGYÉRTELMŰEN azonosítja ezt a konkrét történetet (lásd szabályok lent)",
  "articleType": "event | aggregation | opinion | background",
  "location": "Helyszín (város/ország/régió) vagy null ha nem releváns",
  "entities": ["Legfontosabb személyek, szervezetek, intézmények (max 5)"],
  "topics": ["Témakörök az alábbi listából (1-2): ${TOPICS_LIST}"]
}

SZABÁLYOK a storyIdentity mezőhöz:
- Célja: két cikk CSAK AKKOR tartozik egy story-ba, ha a storyIdentity-jük lényegében ugyanazt mondja
- Fogalmazd meg a KONKRÉT cselekvést/eseményt/döntést, ne csak a helyszínt vagy szereplőket
- Példa: "Magyar Péter kordont bontott tiltakozásképpen a Karmelita előtt" vs "A kormány hétvégére megnyitja a Karmelita épületét látogatóknak" — ezek KÉT KÜLÖNBÖZŐ story
- Példa: "Orbán beszédet mondott a parlamentben a költségvetésről" vs "Orbán találkozott Zelenszkijjel Kijevben" — ezek KÉT KÜLÖNBÖZŐ story
- Ha a cikk több különálló eseményt foglal össze (napi összefoglaló, percről percre), az articleType legyen "aggregation"

articleType értékek:
- "event": egy konkrét eseményről/hírről szól
- "aggregation": több eseményt összefoglal (napi összefoglaló, hírfolyam, percről percre, élő közvetítés)
- "opinion": vélemény, publicisztika, szerkesztőségi álláspont
- "background": háttérelemzés, magyarázó cikk, amely nem egy konkrét új eseményről szól

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
// Google AI Studio (via @google/genai SDK)
// ---------------------------------------------------------------------------

async function callGeminiNative(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
  activity: LlmActivity = 'scrape_summarize',
): Promise<string> {
  if (!gemini) throw new Error('Gemini client not configured');

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const response = await gemini.models.generateContent({
        model: config.googleAiStudio.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.3,
          maxOutputTokens: 500,
          ...(jsonMode && { responseMimeType: 'application/json' }),
        },
      });

      const content = response.text;
      if (!content) {
        throw new Error('Empty response from Gemini API');
      }

      const promptTokens = response.usageMetadata?.promptTokenCount;
      const completionTokens = response.usageMetadata?.candidatesTokenCount;

      logger.info(
        { provider: 'gemini', model: config.googleAiStudio.model, promptTokens, completionTokens },
        'LLM call completed',
      );

      logLlmUsage({
        provider: 'gemini',
        model: config.googleAiStudio.model,
        operation: 'chat',
        activity,
        promptTokens,
        completionTokens,
      });

      return content;
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt: attempt + 1 }, 'Gemini call failed, retrying');
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// OpenRouter API (via @openrouter/sdk)
// ---------------------------------------------------------------------------

async function callOpenRouterChat(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
  model?: string,
  activity: LlmActivity = 'scrape_summarize',
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const response = await openrouter.chat.send({
        chatRequest: {
          model: model ?? config.summarizer.openrouterModel,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 500,
          ...(jsonMode && { responseFormat: { type: 'json_object' as const } }),
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Empty response from OpenRouter chat');
      }

      const usedModel = model ?? config.summarizer.openrouterModel;
      const promptTokens = response.usage?.promptTokens;
      const completionTokens = response.usage?.completionTokens;

      logger.info(
        { provider: 'openrouter', model: usedModel, promptTokens, completionTokens },
        'LLM call completed',
      );

      logLlmUsage({
        provider: 'openrouter',
        model: usedModel,
        operation: 'chat',
        activity,
        promptTokens,
        completionTokens,
      });

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

const VALID_ARTICLE_TYPES = new Set(['event', 'aggregation', 'opinion', 'background']);

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

  const articleType = VALID_ARTICLE_TYPES.has(parsed.articleType)
    ? (parsed.articleType as ArticleAnalysis['articleType'])
    : 'event';

  return {
    summary: String(parsed.summary).trim(),
    headline: String(parsed.headline).trim(),
    mainEvent: String(parsed.mainEvent).trim(),
    storyIdentity: parsed.storyIdentity ? String(parsed.storyIdentity).trim() : String(parsed.mainEvent).trim(),
    articleType,
    location: parsed.location ? String(parsed.location).trim() : null,
    entities,
    topics,
  };
}

// ---------------------------------------------------------------------------
// Public API — article analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an article on the fly.
 * Strategy: try Gemini API first (rate-limited). If rate limited, empty response,
 * or error after retries, fall back to OpenRouter.
 */
export async function analyzeArticle(
  title: string,
  body: string | null,
  lead: string | null,
  activity: LlmActivity = 'scrape_summarize',
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.info({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    let raw: string | null = null;
    logger.info({ title, contentLength }, 'Analyzing article via LLM');

    if (gemini) {
      const slot = await acquireRateSlot();
      if (slot === 'ok') {
        try {
          raw = await callGeminiNative(SYSTEM_PROMPT, userPrompt, true, activity);
        } catch (err) {
          logger.warn({ err, title }, 'Gemini failed after retries, falling back to OpenRouter');
        }
      } else {
        logger.info('Gemini daily limit exhausted, falling back to OpenRouter');
      }
    }

    if (!raw) {
      raw = await callOpenRouterChat(SYSTEM_PROMPT, userPrompt, true, undefined, activity);
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
  activity: LlmActivity = 'scrape_summarize',
): Promise<ArticleAnalysis | null> {
  const contentLength = (lead?.length ?? 0) + (body?.length ?? 0);
  if (contentLength < 50) {
    logger.debug({ title }, 'Article too short to analyze, skipping');
    return null;
  }

  try {
    const userPrompt = buildUserPrompt(title, body, lead);
    const raw = await callOpenRouterChat(SYSTEM_PROMPT, userPrompt, true, undefined, activity);
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

export type StoryTitleResult =
  | { coherent: true; title: string; summary: string | null }
  | { coherent: false; groups: number[][] };

export async function generateStoryTitleAndSummary(
  articles: { id: number; title: string; summary: string | null }[],
  activity: LlmActivity = 'scrape_summarize',
): Promise<StoryTitleResult | null> {
  if (articles.length === 0) return null;
  if (articles.length === 1) return null;

  const articleList = articles.map((a, i) => {
    const summary = a.summary ?? a.title;
    return `${i + 1}. [${a.title}] ${summary}`;
  }).join('\n');

  const prompt = `Az alábbi magyar hírforrásokból származó cikkeket egy klaszterbe soroltuk, mert hasonlóak.
Döntsd el, hogy VALÓBAN ugyanarról a KONKRÉT történetről/eseményről szólnak-e.

FONTOS: "ugyanaz a téma" NEM jelenti, hogy "ugyanaz a történet"!
- Különböző idős emberek elleni csalások = KÜLÖNBÖZŐ történetek, még ha mindegyik "idős ember + csalás"
- Különböző celebekről szóló interjúk = KÜLÖNBÖZŐ történetek, még ha mindegyik "celeb + magánélet"
- Különböző közlekedési balesetek = KÜLÖNBÖZŐ történetek, még ha mindegyik "baleset + autópálya"
- Különböző katonai műveletek = KÜLÖNBÖZŐ történetek, még ha mindegyik "Közel-Kelet + hadsereg"
- Különböző környezeti/társadalmi problémák = KÜLÖNBÖZŐ történetek, még ha mindegyik "válság + klíma"
Csak akkor koherens, ha a cikkek UGYANAZT az egy konkrét eseményt/döntést/történést írják le más-más forrásból.

Ha IGEN (koherens klaszter):
- Írj egy semleges, tömör főcímet (max 15 szó)
- Írj egy 2-3 mondatos semleges összefoglalót, amely szintetizálja a különböző források információit
- FONTOS: Nyelvtanilag hibátlan, helyes magyar nyelven fogalmazz

Ha NEM (a cikkek különböző történetekről szólnak):
- Oszd csoportokra a cikkeket úgy, hogy minden csoport egy-egy önálló történetet képviseljen
- Használd a cikkek sorszámát a csoportosításhoz
- Ha egy cikk egyedül áll (nem tartozik másikhoz), tedd egyedül egy csoportba, pl. [[1], [2, 3]]

Válaszolj KIZÁRÓLAG az alábbi JSON formátumban:
Koherens: {"coherent": true, "title": "Főcím", "summary": "Összefoglaló"}
Inkoherens: {"coherent": false, "groups": [[1, 3], [2, 4]]}

Cikkek:
${articleList}`;

  try {
    const storySystemPrompt = 'Egy magyar hírösszefoglaló rendszer vagy. Válaszolj KIZÁRÓLAG a kért JSON formátumban, semmilyen más szöveget ne írj.';
    let raw: string | null = null;

    if (!config.recluster.forceOpenRouter && gemini) {
      const slot = await acquireRateSlot();
      if (slot === 'ok') {
        try {
          raw = await callGeminiNative(storySystemPrompt, prompt, true, activity);
        } catch (err) {
          logger.warn({ err }, 'Gemini failed for story title, falling back to OpenRouter');
        }
      } else {
        logger.info('Gemini daily limit exhausted for story titles, falling back to OpenRouter');
      }
    }

    if (!raw) {
      raw = await callOpenRouterChat(
        storySystemPrompt,
        prompt,
        true,
        config.summarizer.storyModel,
        activity,
      );
    }

    const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.coherent === true && typeof parsed.title === 'string') {
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null;
      return { coherent: true, title: parsed.title.trim(), summary };
    }

    if (parsed.coherent === false && Array.isArray(parsed.groups)) {
      const groups: number[][] = parsed.groups.map((g: unknown[]) =>
        g.map((idx) => {
          const i = (typeof idx === 'number' ? idx : parseInt(String(idx), 10)) - 1;
          return articles[i]?.id;
        }).filter((id): id is number => id != null),
      );
      const validGroups = groups.filter((g) => g.length > 0);
      if (validGroups.length >= 2) {
        return { coherent: false, groups: validGroups };
      }
    }

    // Fallback: treat as coherent with extracted title
    const title = parsed.title ?? parsed.headline;
    if (typeof title === 'string' && title.trim()) {
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : null;
      return { coherent: true, title: title.trim(), summary };
    }

    return null;
  } catch (err) {
    logger.error({ err }, 'Story title/summary generation failed');
    return null;
  }
}
