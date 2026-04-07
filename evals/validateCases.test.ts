import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const repoRoot = '/Users/srinivas/Documents/ArchAgent';
const validatorEntrypoint = path.join(repoRoot, 'evals', 'validateCases.ts');
const validFixture = path.join(
  repoRoot,
  'evals',
  'cases',
  '_fixtures',
  'sample-valid.jsonl'
);
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
    ['--import', 'tsx', validatorEntrypoint, validFixture],
    {
      cwd: repoRoot
    }
  );

  assert.match(result.stdout, /Validated 1 eval case/);
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
