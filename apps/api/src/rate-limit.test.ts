import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRateLimiter } from './rate-limit.js';

test('rate limiter allows requests until the max is reached', () => {
  let now = 1_000;
  const limiter = createInMemoryRateLimiter({
    max: 2,
    windowMs: 60_000,
    now: () => now,
  });

  assert.equal(limiter.check('1.2.3.4').allowed, true);
  assert.equal(limiter.check('1.2.3.4').allowed, true);

  const third = limiter.check('1.2.3.4');
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterSeconds, 60);
});

test('rate limiter resets after the configured window', () => {
  let now = 1_000;
  const limiter = createInMemoryRateLimiter({
    max: 1,
    windowMs: 1_000,
    now: () => now,
  });

  assert.equal(limiter.check('1.2.3.4').allowed, true);
  assert.equal(limiter.check('1.2.3.4').allowed, false);

  now = 2_001;
  const afterReset = limiter.check('1.2.3.4');
  assert.equal(afterReset.allowed, true);
  assert.equal(afterReset.remaining, 0);
});
