import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  compareSuiteExecutions,
  renderComparisonMarkdown
} from './compareBranchVsMain.js';

const execFileAsync = promisify(execFile);

const currentFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFilePath), '..');
const comparisonEntrypoint = path.join(
  repoRoot,
  'evals',
  'compareBranchVsMain.ts'
);

test('compareSuiteExecutions highlights new failures, recommendation drift, new unknowns, and latency deltas', () => {
  const baselineSuites = [
    {
      suiteId: 'deterministic-release',
      cwd: '/baseline',
      durationMs: 50,
      summary: {
        totals: {
          cases: 1,
          passed: 1,
          failed: 0,
          skipped: 0
        },
        results: [
          {
            caseId: 'microsoft-fabric',
            category: 'product-specificity',
            outcome: 'passed' as const,
            detail: 'baseline',
            durationMs: 20,
            snapshot: {
              recommendation: 'green' as const,
              guardrails: {
                euDataResidency: { status: 'supported' as const },
                enterpriseDeployment: { status: 'supported' as const }
              }
            }
          }
        ]
      }
    },
    {
      suiteId: 'public-surface',
      cwd: '/baseline',
      durationMs: 20,
      summary: {
        totals: {
          cases: 1,
          passed: 1,
          failed: 0
        },
        results: [
          {
            caseId: 'health-minimal',
            category: 'endpoint-exposure',
            outcome: 'passed' as const,
            detail: 'baseline',
            durationMs: 8
          }
        ]
      }
    }
  ];

  const candidateSuites = [
    {
      suiteId: 'deterministic-release',
      cwd: '/candidate',
      durationMs: 70,
      summary: {
        totals: {
          cases: 1,
          passed: 0,
          failed: 1,
          skipped: 0
        },
        results: [
          {
            caseId: 'microsoft-fabric',
            category: 'product-specificity',
            outcome: 'failed' as const,
            detail: 'regressed',
            durationMs: 90,
            snapshot: {
              recommendation: 'yellow' as const,
              guardrails: {
                euDataResidency: { status: 'unknown' as const },
                enterpriseDeployment: { status: 'supported' as const }
              }
            }
          }
        ]
      }
    },
    {
      suiteId: 'public-surface',
      cwd: '/candidate',
      durationMs: 25,
      summary: {
        totals: {
          cases: 1,
          passed: 0,
          failed: 1
        },
        results: [
          {
            caseId: 'health-minimal',
            category: 'endpoint-exposure',
            outcome: 'failed' as const,
            detail: 'database leaked',
            durationMs: 16
          }
        ]
      }
    }
  ];

  const comparison = compareSuiteExecutions(baselineSuites, candidateSuites);

  assert.equal(comparison.newFailures.length, 2);
  assert.equal(comparison.changedRecommendations.length, 1);
  assert.equal(comparison.newUnknownOutputs.length, 1);
  assert.ok(comparison.latencyDeltas.some((item) => item.caseId === 'microsoft-fabric'));

  const markdown = renderComparisonMarkdown({
    generatedAt: '2026-04-08T21:00:00.000Z',
    modelSetting: {
      value: 'gpt-5.4-test',
      source: 'EVAL_MODEL'
    },
    baseline: {
      label: 'origin/main',
      cwd: '/baseline',
      suites: baselineSuites
    },
    candidate: {
      label: 'candidate',
      cwd: '/candidate',
      suites: candidateSuites
    },
    regressions: {
      newFailures: comparison.newFailures,
      changedRecommendations: comparison.changedRecommendations,
      newUnknownOutputs: comparison.newUnknownOutputs,
      latencyDeltas: comparison.latencyDeltas
    },
    improvements: {
      resolvedFailures: comparison.resolvedFailures
    }
  });

  assert.match(markdown, /Changed Recommendations/);
  assert.match(markdown, /microsoft-fabric/);
  assert.match(markdown, /New Unknown Outputs/);
});

test('compareSuiteExecutions records unmatched failed cases instead of dropping them', () => {
  const baselineSuites = [
    {
      suiteId: 'public-surface',
      cwd: '/baseline',
      durationMs: 10,
      summary: {
        totals: {
          cases: 1,
          passed: 0,
          failed: 1
        },
        results: [
          {
            caseId: 'runner-failure',
            category: 'endpoint-exposure',
            outcome: 'failed' as const,
            detail: 'baseline failed',
            durationMs: 3
          }
        ]
      }
    }
  ];

  const candidateSuites = [
    {
      suiteId: 'public-surface',
      cwd: '/candidate',
      durationMs: 10,
      summary: {
        totals: {
          cases: 1,
          passed: 0,
          failed: 1
        },
        results: [
          {
            caseId: '<runner>',
            category: 'endpoint-exposure',
            outcome: 'failed' as const,
            detail: 'candidate runner failed',
            durationMs: 1
          }
        ]
      }
    }
  ];

  const comparison = compareSuiteExecutions(baselineSuites, candidateSuites);

  assert.deepEqual(comparison.newFailures, [
    {
      suiteId: 'public-surface',
      caseId: '<runner>',
      category: 'endpoint-exposure',
      baselineOutcome: 'missing',
      candidateOutcome: 'failed',
      detail: 'candidate runner failed'
    }
  ]);
  assert.deepEqual(comparison.resolvedFailures, [
    {
      suiteId: 'public-surface',
      caseId: 'runner-failure',
      category: 'endpoint-exposure',
      baselineOutcome: 'failed',
      candidateOutcome: 'missing',
      detail: 'baseline failed'
    }
  ]);
});

test('compareBranchVsMain runner writes JSON and Markdown reports for identical code trees', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'archagent-compare-'));
  const result = await execFileAsync(
    'node',
    [
      '--import',
      'tsx',
      comparisonEntrypoint,
      '--baseline-dir',
      repoRoot,
      '--candidate-dir',
      repoRoot,
      '--output-dir',
      outputDir
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        EVAL_MODEL: 'gpt-5.4-test'
      }
    }
  );

  const summary = JSON.parse(result.stdout) as {
    jsonPath: string;
    markdownPath: string;
    regressions: {
      newFailures: unknown[];
      changedRecommendations: unknown[];
      newUnknownOutputs: unknown[];
    };
  };

  assert.deepEqual(summary.regressions.newFailures, []);
  assert.deepEqual(summary.regressions.changedRecommendations, []);
  assert.deepEqual(summary.regressions.newUnknownOutputs, []);

  await access(summary.jsonPath);
  await access(summary.markdownPath);

  const markdown = await readFile(summary.markdownPath, 'utf8');
  assert.match(markdown, /Branch vs Main Release Comparison/);
  assert.match(markdown, /Model setting: `gpt-5.4-test`/);
});
