import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { ArticleCandidate, BaseAdapter } from './base.js';

test('ArticleCandidate carries RSS metadata without requiring article HTML', () => {
  const candidate: ArticleCandidate = {
    url: 'https://example.com/article',
    title: 'Example article',
    sourceSlug: 'example',
    bodyFallback: 'RSS summary',
    publishedAt: new Date('2026-05-19T00:00:00.000Z'),
  };

  assert.equal(candidate.url, 'https://example.com/article');
  assert.equal(candidate.bodyFallback, 'RSS summary');
});

test('BaseAdapter exposes candidate discovery and article extraction', () => {
  const methods: Array<keyof BaseAdapter> = ['fetchCandidates', 'extractArticle'];
  assert.deepEqual(methods, ['fetchCandidates', 'extractArticle']);
});
