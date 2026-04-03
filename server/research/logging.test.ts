import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInputForLog } from './logging.js';

test('summarizeInputForLog returns a bounded preview and full normalized length', () => {
  const input = `  ${'A'.repeat(120)}   `;
  const summary = summarizeInputForLog(input, 20);

  assert.equal(summary.length, 120);
  assert.equal(summary.preview.length, 20);
  assert.match(summary.preview, /^A{17}\.\.\.$/);
});
