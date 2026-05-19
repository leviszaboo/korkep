import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  articleNeedsRepair,
  capRepairCandidates,
  getRepairWindow,
  isBrokenText,
  shouldRepairStorySummary,
  storyNeedsSummaryRepair,
  storySummaryUpdateFromResult,
} from './repair.js';

test('isBrokenText treats null, empty, whitespace, and placeholder-like values as broken', () => {
  assert.equal(isBrokenText(null), true);
  assert.equal(isBrokenText(''), true);
  assert.equal(isBrokenText('   '), true);
  assert.equal(isBrokenText('N/A'), true);
  assert.equal(isBrokenText('null'), true);
  assert.equal(isBrokenText('undefined'), true);
});

test('isBrokenText treats real text as present', () => {
  assert.equal(isBrokenText('A real Hungarian story summary.'), false);
});

test('articleNeedsRepair catches missing summaries and missing embeddings', () => {
  assert.equal(articleNeedsRepair({ summary: null, embedding: [0.1] }), true);
  assert.equal(articleNeedsRepair({ summary: 'ok', embedding: null }), true);
  assert.equal(articleNeedsRepair({ summary: 'ok', embedding: [0.1] }), false);
});

test('storyNeedsSummaryRepair catches missing story summaries only', () => {
  assert.equal(storyNeedsSummaryRepair({ summary: null }), true);
  assert.equal(storyNeedsSummaryRepair({ summary: '   ' }), true);
  assert.equal(storyNeedsSummaryRepair({ summary: 'A synthesized summary.' }), false);
});

test('shouldRepairStorySummary skips stories with fewer than two articles', () => {
  assert.equal(shouldRepairStorySummary({ summary: null, articleCount: 0 }), false);
  assert.equal(shouldRepairStorySummary({ summary: null, articleCount: 1 }), false);
  assert.equal(shouldRepairStorySummary({ summary: null, articleCount: 2 }), true);
  assert.equal(shouldRepairStorySummary({ summary: 'Existing summary', articleCount: 2 }), false);
});

test('capRepairCandidates returns at most the configured positive limit', () => {
  const candidates = [{ id: 1 }, { id: 2 }, { id: 3 }];

  assert.deepEqual(capRepairCandidates(candidates, 2), [{ id: 1 }, { id: 2 }]);
});

test('capRepairCandidates returns no candidates when limit is zero', () => {
  const candidates = [{ id: 1 }, { id: 2 }];

  assert.deepEqual(capRepairCandidates(candidates, 0), []);
});

test('getRepairWindow applies lookback and grace cutoffs', () => {
  const now = new Date('2026-05-19T12:00:00.000Z');

  assert.deepEqual(getRepairWindow(now, 24, 90), {
    oldest: new Date('2026-05-18T12:00:00.000Z'),
    newest: new Date('2026-05-19T10:30:00.000Z'),
  });
});

test('storySummaryUpdateFromResult returns generated summary for coherent stories', () => {
  assert.deepEqual(
    storySummaryUpdateFromResult({ coherent: true, title: 'Story title', summary: 'Generated story summary' }),
    { title: 'Story title', summary: 'Generated story summary' },
  );
});

test('storySummaryUpdateFromResult ignores incoherent story result', () => {
  assert.equal(
    storySummaryUpdateFromResult({ coherent: false, groups: [[1], [2]] }),
    null,
  );
});

test('storySummaryUpdateFromResult rejects coherent result without summary', () => {
  assert.equal(
    storySummaryUpdateFromResult({ coherent: true, title: 'Story title', summary: null }),
    null,
  );
});
