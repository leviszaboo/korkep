import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageVectors,
  buildRecursiveMergeGroups,
  cosineSimilarity,
} from './utils/recluster-merge.js';

test('cosineSimilarity returns zero for empty or mismatched vectors', () => {
  assert.equal(cosineSimilarity([], [1, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [1]), 0);
});

test('averageVectors averages matching vectors and skips mismatched vectors', () => {
  assert.deepEqual(averageVectors([[1, 0], [0, 1], [10]]), [0.5, 0.5]);
});

test('buildRecursiveMergeGroups recomputes centroid after each merge', () => {
  const groups = buildRecursiveMergeGroups(
    [
      { articleIds: [1], centroid: [1, 0] },
      { articleIds: [2], centroid: [0.8, 0.6] },
      { articleIds: [3], centroid: [0.8, -0.6] },
    ],
    0.55,
    10,
  );

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sort((a, b) => a - b), [0, 1, 2]);
});

test('buildRecursiveMergeGroups respects the merged article cap', () => {
  const groups = buildRecursiveMergeGroups(
    [
      { articleIds: Array.from({ length: 24 }, (_, i) => i), centroid: [1, 0] },
      { articleIds: Array.from({ length: 24 }, (_, i) => i + 24), centroid: [1, 0] },
    ],
    0.9,
    24,
  );

  assert.equal(groups.length, 2);
});
