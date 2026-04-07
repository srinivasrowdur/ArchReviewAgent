import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalCaseSchema } from './caseSchema.js';

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), '..');
const releaseCorePath = path.join(repoRoot, 'evals', 'cases', 'release-core.jsonl');

test('release-core dataset has the required minimum size and category coverage', async () => {
  const content = await readFile(releaseCorePath, 'utf8');
  const cases = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => evalCaseSchema.parse(JSON.parse(line)));

  assert.ok(cases.length >= 20, 'release-core dataset should contain at least 20 cases');

  const categories = new Set(cases.map((item) => item.category));

  for (const requiredCategory of [
    'normal-vendor',
    'product-vs-parent',
    'typo-alias',
    'ambiguous-name',
    'prompt-injection-like',
    'insufficient-evidence',
    'transfer-law-only',
    'cache-sensitive'
  ]) {
    assert.ok(
      categories.has(requiredCategory),
      `release-core dataset is missing required category ${requiredCategory}`
    );
  }
});
