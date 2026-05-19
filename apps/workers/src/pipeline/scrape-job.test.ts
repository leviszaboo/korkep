import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { SourceConfig } from '@korkep/shared';
import type { ArticleCandidate } from '../adapters/base.js';
import { filterNewCandidatesByUrl, getAdapterForSource, shouldScrapeSource, withSourceTimeout } from './scrape-job.js';

test('withSourceTimeout rejects when a source exceeds the timeout', async () => {
  const started = Date.now();

  await assert.rejects(
    withSourceTimeout('slow-source', new Promise(() => {}), 10),
    /timed out after 10ms/,
  );

  assert.ok(Date.now() - started < 250);
});

test('withSourceTimeout resolves successful work', async () => {
  const result = await withSourceTimeout('fast-source', Promise.resolve(['ok']), 1_000);

  assert.deepEqual(result, ['ok']);
});

test('filterNewCandidatesByUrl removes candidates already present in the database', () => {
  const candidates: ArticleCandidate[] = [
    { url: 'https://example.com/old', title: 'Old', sourceSlug: 'example' },
    { url: 'https://example.com/new', title: 'New', sourceSlug: 'example' },
  ];

  const result = filterNewCandidatesByUrl(candidates, new Set(['https://example.com/old']));

  assert.deepEqual(result, [
    { url: 'https://example.com/new', title: 'New', sourceSlug: 'example' },
  ]);
});

test('getAdapterForSource includes all configured custom source adapters', () => {
  assert.ok(getAdapterForSource('mti'));
  assert.ok(getAdapterForSource('kontroll'));
  assert.ok(getAdapterForSource('demokrata'));
});

test('shouldScrapeSource allows adapter-backed sources without RSS feeds', () => {
  const mti: SourceConfig = {
    name: 'MTI',
    slug: 'mti',
    url: 'https://mti.hu',
    rssUrl: '',
    biasRating: 'center-right',
    scrapeIntervalMinutes: 15,
  };

  assert.equal(shouldScrapeSource(mti), true);
});
