import { strict as assert } from 'node:assert';
import test from 'node:test';

test('repair config defaults are production bounded', async () => {
  const original = { ...process.env };
  delete process.env.REPAIR_LOOKBACK_HOURS;
  delete process.env.REPAIR_MAX_ARTICLES;
  delete process.env.REPAIR_MAX_STORIES;
  delete process.env.REPAIR_EMBEDDING_BATCH_SIZE;
  delete process.env.REPAIR_GRACE_MINUTES;

  const mod = await import(`./config.js?defaults=${Date.now()}`);

  assert.equal(mod.config.repair.lookbackHours, 24);
  assert.equal(mod.config.repair.maxArticles, 100);
  assert.equal(mod.config.repair.maxStories, 50);
  assert.equal(mod.config.repair.embeddingBatchSize, 50);
  assert.equal(mod.config.repair.graceMinutes, 90);

  process.env = original;
});

test('repair config reads explicit environment overrides', async () => {
  const original = { ...process.env };
  process.env.REPAIR_LOOKBACK_HOURS = '48';
  process.env.REPAIR_MAX_ARTICLES = '25';
  process.env.REPAIR_MAX_STORIES = '10';
  process.env.REPAIR_EMBEDDING_BATCH_SIZE = '20';
  process.env.REPAIR_GRACE_MINUTES = '45';

  const mod = await import(`./config.js?overrides=${Date.now()}`);

  assert.equal(mod.config.repair.lookbackHours, 48);
  assert.equal(mod.config.repair.maxArticles, 25);
  assert.equal(mod.config.repair.maxStories, 10);
  assert.equal(mod.config.repair.embeddingBatchSize, 20);
  assert.equal(mod.config.repair.graceMinutes, 45);

  process.env = original;
});
