import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntInRange } from './config.js';

test('parseIntInRange falls back for invalid values', () => {
  assert.equal(parseIntInRange('nope', 5, 1, 20), 5);
  assert.equal(parseIntInRange('', 5, 1, 20), 5);
});

test('parseIntInRange clamps unsafe values', () => {
  assert.equal(parseIntInRange('0', 5, 1, 20), 1);
  assert.equal(parseIntInRange('-10', 5, 1, 20), 1);
  assert.equal(parseIntInRange('999', 5, 1, 20), 20);
});
