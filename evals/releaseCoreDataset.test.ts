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

test('success cases cannot use inputs that violate intake minimum length after trim', async () => {
  assert.throws(
    () =>
      evalCaseSchema.parse({
        id: 'invalid-success-short-input',
        category: 'input-validation',
        input: ' x ',
        expected_outcome: 'success',
        expected_subject: 'Example',
        expected_vendor: 'Example',
        expected_official_domains: ['example.com'],
        expected_guardrails: {
          euDataResidency: {
            status: 'supported',
            allow_equivalents: []
          },
          enterpriseDeployment: {
            status: 'supported',
            allow_equivalents: []
          }
        },
        expected_recommendation: 'green',
        allowed_unknowns: [],
        notes: 'Invalid success case for schema regression coverage.'
      }),
    /String must contain at least 2 character/
  );
});
