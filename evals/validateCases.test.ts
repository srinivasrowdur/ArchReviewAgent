import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), '..');
const validatorEntrypoint = path.join(repoRoot, 'evals', 'validateCases.ts');
const sampleCaseFile = path.join(repoRoot, 'evals', 'cases', 'sample-case.jsonl');
const invalidFixture = path.join(
  repoRoot,
  'evals',
  'cases',
  '_fixtures',
  'sample-invalid.jsonl'
);

test('eval case validator accepts valid fixtures', async () => {
  const result = await execFileAsync(
    'node',
    ['--import', 'tsx', validatorEntrypoint, sampleCaseFile],
    {
      cwd: repoRoot
    }
  );

  assert.match(result.stdout, /Validated 1 eval case/);
});

test('eval case validator skips fixture files in the default scan', async () => {
  const result = await execFileAsync(
    'node',
    ['--import', 'tsx', validatorEntrypoint],
    {
      cwd: repoRoot
    }
  );

  assert.match(result.stdout, /Validated \d+ eval cases across \d+ files\./);
});

test('eval case validator rejects invalid fixtures', async () => {
  await assert.rejects(
    execFileAsync(
      'node',
      ['--import', 'tsx', validatorEntrypoint, invalidFixture],
      {
        cwd: repoRoot
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid eval case/);
      return true;
    }
  );
});
