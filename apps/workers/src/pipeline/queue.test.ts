import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQueueIds } from './queue.js';

test('normalizeQueueIds keeps valid numeric ids only', () => {
  assert.deepEqual(normalizeQueueIds(['1', 'bad', '2', 'NaN', '3']), [1, 2, 3]);
});

test('normalizeQueueIds drops zero and negative ids', () => {
  assert.deepEqual(normalizeQueueIds(['0', '-1', '4']), [4]);
});
