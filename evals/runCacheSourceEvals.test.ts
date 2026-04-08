import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), '..');
const runnerEntrypoint = path.join(repoRoot, 'evals', 'runCacheSourceEvals.ts');
const datasetPath = path.join(
  repoRoot,
  'evals',
  'cases',
  'cache-source-deterministic.jsonl'
);

test('cache/source eval runner passes on the current baseline', async () => {
  const result = await execFileAsync(
    'node',
    ['--import', 'tsx', runnerEntrypoint, datasetPath],
    {
      cwd: repoRoot
    }
  );

  const summary = JSON.parse(result.stdout) as {
    totals: { cases: number; passed: number; failed: number };
  };

  assert.equal(summary.totals.failed, 0);
  assert.ok(summary.totals.passed > 0);
  assert.ok(summary.totals.cases >= summary.totals.passed);
});

test('cache/source eval runner reports targeted failures', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'archagent-cache-evals-'));
  const casePath = path.join(tempDir, 'mismatch.jsonl');

  await writeFile(
    casePath,
    `${JSON.stringify({
      id: 'mismatch-source-safety',
      category: 'source-safety',
      url: 'https://docs.databricks.com/security?utm_source=test',
      allowedDomains: ['databricks.com'],
      expected: {
        normalizedUrl: 'https://wrong.example/path',
        allowed: true
      },
      notes: 'Intentional mismatch to verify targeted failure reporting.'
    })}\n`
  );

  await assert.rejects(
    execFileAsync(
      'node',
      ['--import', 'tsx', runnerEntrypoint, casePath],
      {
        cwd: repoRoot
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const stdout = 'stdout' in error ? String((error as { stdout?: unknown }).stdout) : '';
      const summary = JSON.parse(stdout) as {
        totals: { failed: number };
        results: Array<{ caseId: string; outcome: string; detail: string }>;
      };

      assert.equal(summary.totals.failed, 1);
      assert.equal(summary.results[0]?.caseId, 'mismatch-source-safety');
      assert.equal(summary.results[0]?.outcome, 'failed');
      assert.match(summary.results[0]?.detail ?? '', /normalized URL mismatch/);
      return true;
    }
  );
});
