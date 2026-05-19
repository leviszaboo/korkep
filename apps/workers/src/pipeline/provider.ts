import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { logLlmUsage, normalizeLlmMode, type LlmActivity, type LlmMode } from '../lib/llm-usage.js';

// ---------------------------------------------------------------------------
// SDK clients
// ---------------------------------------------------------------------------

const gemini = config.googleAiStudio.apiKey
  ? new GoogleGenAI({ apiKey: config.googleAiStudio.apiKey })
  : null;

const openrouter = new OpenRouter({ apiKey: config.openrouter.apiKey });

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter for Google AI Studio (15 req/min, 1500 req/day free tier)
// Always uses Redis (Upstash in cloud, Docker Redis locally).
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
    const r = new Redis(config.redis.url, {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    r.on('error', () => {});
    await r.connect();
    redisInstance = r;
    redisAvailable = true;
    return r;
  } catch {
    logger.info('Redis not available for rate limiter, using in-memory fallback');
    redisAvailable = false;
    return null;
  }
}

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
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const dayTtl = Math.ceil((midnight.getTime() - Date.now()) / 1000);

  while (true) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await r.eval(
      `
        local minuteKey = KEYS[1]
        local dayKey = KEYS[2]
        local now = tonumber(ARGV[1])
        local windowStart = tonumber(ARGV[2])
        local maxMinute = tonumber(ARGV[3])
        local maxDay = tonumber(ARGV[4])
        local id = ARGV[5]
        local minuteTtl = tonumber(ARGV[6])
        local dayTtl = tonumber(ARGV[7])

        redis.call('ZREMRANGEBYSCORE', minuteKey, 0, windowStart)

        local daily = tonumber(redis.call('GET', dayKey) or '0')
        if daily >= maxDay then
          return { 'daily_exhausted', 0, redis.call('ZCARD', minuteKey) }
        end

        local current = redis.call('ZCARD', minuteKey)
        if current >= maxMinute then
          local oldest = redis.call('ZRANGE', minuteKey, 0, 0, 'WITHSCORES')
          return { 'minute_exhausted', oldest[2] or now, current }
        end

        redis.call('ZADD', minuteKey, now, id)
        redis.call('EXPIRE', minuteKey, minuteTtl)
        local newDaily = redis.call('INCR', dayKey)
        if newDaily == 1 then redis.call('EXPIRE', dayKey, dayTtl) end
        return { 'ok', 0, current + 1 }
      `,
      2,
      REDIS_KEY_MINUTE,
      REDIS_KEY_DAY,
      String(now),
      String(now - minuteWindow),
      String(config.googleAiStudio.maxPerMinute),
      String(config.googleAiStudio.maxPerDay),
      id,
      String(minuteWindow + 5),
      String(dayTtl),
    ) as [string, number | string, number | string];

    if (result[0] === 'ok') return 'ok';
    if (result[0] === 'daily_exhausted') return 'daily_exhausted';

    const oldestTs = typeof result[1] === 'number' ? result[1] : parseInt(result[1], 10);
    const currentCount = typeof result[2] === 'number' ? result[2] : parseInt(result[2], 10);
    const waitMs = Math.max((oldestTs + minuteWindow - Math.floor(Date.now() / 1000)) * 1000, 1000);
    logger.info({ waitMs, currentCount }, 'Gemini rate limit reached, waiting');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// ---------------------------------------------------------------------------
// LLM call functions
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;

export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean,
  activity: LlmActivity,
  mode: LlmMode = 'gemini-fallback',
): Promise<string> {
  if (!gemini) throw new Error('Gemini client not configured');

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const response = await withTimeout(gemini.models.generateContent({
        model: config.googleAiStudio.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.3,
          maxOutputTokens: 500,
          ...(jsonMode && { responseMimeType: 'application/json' }),
        },
      }), config.llm.requestTimeoutMs, 'Gemini generateContent');

      const content = response.text;
      if (!content) throw new Error('Empty response from Gemini API');

      const promptTokens = response.usageMetadata?.promptTokenCount;
      const completionTokens = response.usageMetadata?.candidatesTokenCount;

      logger.info(
        { provider: 'gemini', model: config.googleAiStudio.model, promptTokens, completionTokens },
        'LLM call completed',
      );

      logLlmUsage({
        provider: 'gemini',
        mode,
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

export async function callOpenRouterChat(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean,
  model: string,
  activity: LlmActivity,
  mode: LlmMode = 'openrouter',
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }

    try {
      const response = await withTimeout(openrouter.chat.send({
        chatRequest: {
          model,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 500,
          ...(jsonMode && { responseFormat: { type: 'json_object' as const } }),
        },
      }), config.llm.requestTimeoutMs, 'OpenRouter chat');

      const content = response.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Empty response from OpenRouter chat');
      }

      const promptTokens = response.usage?.promptTokens;
      const completionTokens = response.usage?.completionTokens;

      logger.info(
        { provider: 'openrouter', model, promptTokens, completionTokens },
        'LLM call completed',
      );

      logLlmUsage({
        provider: 'openrouter',
        mode,
        model,
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
// Public API — provider-aware chat call
// ---------------------------------------------------------------------------

export type ProviderConfig = {
  provider: 'openrouter' | 'gemini-fallback';
  model: string;
};

export async function callChat(
  providerConfig: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean,
  activity: LlmActivity,
): Promise<string> {
  if (providerConfig.provider === 'gemini-fallback' && gemini) {
    const slot = await acquireRateSlot();
    if (slot === 'ok') {
      try {
        return await callGemini(systemPrompt, userPrompt, jsonMode, activity, normalizeLlmMode(providerConfig.provider));
      } catch (err) {
        logger.warn({ err }, 'Gemini failed after retries, falling back to OpenRouter');
      }
    } else {
      logger.info('Gemini daily limit exhausted, falling back to OpenRouter');
    }
  }

  return callOpenRouterChat(
    systemPrompt,
    userPrompt,
    jsonMode,
    providerConfig.model,
    activity,
    normalizeLlmMode(providerConfig.provider),
  );
}

export { openrouter };
