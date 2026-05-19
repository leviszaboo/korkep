import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createInMemoryRateLimiter(options: RateLimitOptions) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function check(key: string): RateLimitResult {
    const current = now();
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= current
      ? { count: 0, resetAt: current + options.windowMs }
      : existing;

    bucket.count += 1;
    buckets.set(key, bucket);

    const resetSeconds = Math.max(Math.ceil((bucket.resetAt - current) / 1000), 0);
    const allowed = bucket.count <= options.max;

    return {
      allowed,
      limit: options.max,
      remaining: Math.max(options.max - bucket.count, 0),
      resetSeconds,
      retryAfterSeconds: allowed ? 0 : resetSeconds,
    };
  }

  function prune(): void {
    const current = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
  }

  return { check, prune };
}

function setRateLimitHeaders(reply: FastifyReply, result: RateLimitResult): void {
  reply.header('X-RateLimit-Limit', result.limit);
  reply.header('X-RateLimit-Remaining', result.remaining);
  reply.header('X-RateLimit-Reset', result.resetSeconds);
  if (!result.allowed) {
    reply.header('Retry-After', result.retryAfterSeconds);
  }
}

export function registerRateLimit(app: {
  addHook: {
    (name: 'onRequest', hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void>): unknown;
    (name: 'onClose', hook: (_instance: unknown, done: () => void) => void): unknown;
  };
}, options: {
  enabled: boolean;
  max: number;
  windowMs: number;
  searchMax: number;
}): void {
  if (!options.enabled) return;

  const globalLimiter = createInMemoryRateLimiter({
    max: options.max,
    windowMs: options.windowMs,
  });
  const searchLimiter = createInMemoryRateLimiter({
    max: options.searchMax,
    windowMs: options.windowMs,
  });

  const pruneTimer = setInterval(() => {
    globalLimiter.prune();
    searchLimiter.prune();
  }, options.windowMs);
  pruneTimer.unref();
  app.addHook('onClose', (_instance, done) => {
    clearInterval(pruneTimer);
    done();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;

    const ip = clientIp(request);
    const routeKey = request.url.split('?')[0] === '/api/search' ? 'search' : 'global';
    const limiter = routeKey === 'search' ? searchLimiter : globalLimiter;
    const result = limiter.check(`${routeKey}:${ip}`);
    setRateLimitHeaders(reply, result);

    if (!result.allowed) {
      reply.code(429);
      return reply.send({
        error: 'Rate limit exceeded',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  });
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(',')[0].trim();
  }
  return request.ip;
}
