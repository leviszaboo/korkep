import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLlmMode } from './llm-usage.js';

test('normalizeLlmMode preserves supported configured provider modes', () => {
  assert.equal(normalizeLlmMode('openrouter'), 'openrouter');
  assert.equal(normalizeLlmMode('gemini-fallback'), 'gemini-fallback');
});

test('normalizeLlmMode falls back to openrouter for unknown values', () => {
  assert.equal(normalizeLlmMode(undefined), 'openrouter');
  assert.equal(normalizeLlmMode(''), 'openrouter');
  assert.equal(normalizeLlmMode('gemini'), 'openrouter');
});
