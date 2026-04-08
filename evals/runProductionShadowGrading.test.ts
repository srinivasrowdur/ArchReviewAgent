import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadShadowTracesFromFile,
  runProductionShadowGrading,
  writeProductionShadowReports
} from './runProductionShadowGrading.js';
import type { StoredResearchRunTrace } from '../server/db/researchRunTraceRepository.js';

test('production shadow grading flags low scores, unknowns, recommendation changes, and failures', async () => {
  const traces = [
    createTrace({
      runId: 'old-miro',
      requestedSubjectName: 'Miro',
      subjectKey: 'miro',
      recommendation: 'yellow',
      euStatus: 'supported',
      enterpriseStatus: 'supported',
      createdAt: '2026-04-08T09:00:00.000Z'
    }),
    createTrace({
      runId: 'new-miro',
      requestedSubjectName: 'Miro',
      subjectKey: 'miro',
      recommendation: 'green',
      euStatus: 'supported',
      enterpriseStatus: 'supported',
      createdAt: '2026-04-08T10:00:00.000Z'
    }),
    createTrace({
      runId: 'dbx-unknown',
      requestedSubjectName: 'Databricks',
      subjectKey: 'databricks',
      recommendation: 'yellow',
      euStatus: 'unknown',
      enterpriseStatus: 'supported',
      createdAt: '2026-04-08T11:00:00.000Z'
    }),
    createTrace({
      runId: 'failed-run',
      requestedSubjectName: 'Palantir',
      subjectKey: 'palantir',
      recommendation: null,
      euStatus: null,
      enterpriseStatus: null,
      createdAt: '2026-04-08T12:00:00.000Z',
      report: null,
      outcome: 'failed',
      errorMessage: 'Decision stage failed.'
    })
  ];

  const summary = await runProductionShadowGrading(traces, {
    gradeProductResolution: async (input) => ({
      pass: input.requestedSubject !== 'Databricks',
      score: input.requestedSubject === 'Databricks' ? 0.55 : 0.9,
      reason: 'Stubbed product-resolution grade.',
      flags: input.requestedSubject === 'Databricks' ? ['generic_overview'] : [],
      subjectAnchoring: 'product',
      subjectResolutionQuality: input.requestedSubject === 'Databricks' ? 'partial' : 'strong',
      overviewSpecificity: input.requestedSubject === 'Databricks' ? 'mixed' : 'specific'
    }),
    gradeGuardrailQuality: async (input) => ({
      pass: input.requestedSubject !== 'Databricks',
      score: input.requestedSubject === 'Databricks' ? 0.62 : 0.86,
      reason: 'Stubbed guardrail-quality grade.',
      flags: input.requestedSubject === 'Databricks' ? ['thin_evidence'] : [],
      euResidencyVerdictSupport: input.requestedSubject === 'Databricks' ? 'poor' : 'strong',
      enterpriseDeploymentVerdictSupport: 'strong',
      recommendationQuality: input.requestedSubject === 'Databricks' ? 'unclear' : 'justified',
      citationRelevance: input.requestedSubject === 'Databricks' ? 'mixed' : 'strong'
    })
  });

  assert.equal(summary.totals.traces, 4);
  assert.equal(summary.totals.graded, 3);
  assert.equal(summary.totals.failures, 1);
  assert.deepEqual(summary.lowScoringRunIds, ['dbx-unknown']);
  assert.deepEqual(summary.unknownRunIds, ['dbx-unknown']);
  assert.deepEqual(summary.recommendationChangedRunIds, ['new-miro']);
});

test('production shadow grading writes JSON and markdown reports to a stable output directory', async () => {
  const traces = await loadShadowTracesFromFile(
    'evals/cases/_fixtures/shadow-traces.sample.jsonl'
  );
  const summary = await runProductionShadowGrading(traces, {
    gradeProductResolution: async () => ({
      pass: true,
      score: 0.9,
      reason: 'Looks good.',
      flags: [],
      subjectAnchoring: 'product',
      subjectResolutionQuality: 'strong',
      overviewSpecificity: 'specific'
    }),
    gradeGuardrailQuality: async () => ({
      pass: true,
      score: 0.84,
      reason: 'Looks supported.',
      flags: [],
      euResidencyVerdictSupport: 'strong',
      enterpriseDeploymentVerdictSupport: 'strong',
      recommendationQuality: 'justified',
      citationRelevance: 'strong'
    })
  });
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'shadow-grade-'));
  const paths = await writeProductionShadowReports(summary, outputRoot);
  const jsonContent = JSON.parse(await readFile(paths.jsonPath, 'utf8')) as {
    totals: { traces: number };
  };
  const markdownContent = await readFile(paths.markdownPath, 'utf8');

  assert.equal(jsonContent.totals.traces, 2);
  assert.match(markdownContent, /# Production Shadow Grading Summary/);
  assert.match(markdownContent, /## Totals/);
});

function createTrace(
  overrides: Partial<StoredResearchRunTrace> & {
    runId: string;
    requestedSubjectName: string;
    createdAt: string;
  }
): StoredResearchRunTrace {
  const report =
    overrides.report === null
      ? null
      : {
          companyName: overrides.requestedSubjectName,
          researchedAt: overrides.createdAt,
          overview: `${overrides.requestedSubjectName} product overview.`,
          executiveSummary: `${overrides.requestedSubjectName} executive summary.`,
          recommendation: (overrides.recommendation ?? 'green') as 'green' | 'yellow' | 'red',
          deploymentVerdict: `${overrides.requestedSubjectName} deployment verdict.`,
          guardrails: {
            euDataResidency: {
              status: (overrides.euStatus ?? 'supported') as
                | 'supported'
                | 'partial'
                | 'unsupported'
                | 'unknown',
              confidence: 'medium' as const,
              summary: 'EU summary.',
              risks: [],
              evidence: [
                {
                  title: 'EU evidence',
                  url: 'https://example.com/eu',
                  publisher: 'Example',
                  finding: 'EU finding.',
                  sourceType: 'primary' as const
                }
              ]
            },
            enterpriseDeployment: {
              status: (overrides.enterpriseStatus ?? 'supported') as
                | 'supported'
                | 'partial'
                | 'unsupported'
                | 'unknown',
              confidence: 'medium' as const,
              summary: 'Enterprise summary.',
              risks: [],
              evidence: [
                {
                  title: 'Enterprise evidence',
                  url: 'https://example.com/enterprise',
                  publisher: 'Example',
                  finding: 'Enterprise finding.',
                  sourceType: 'primary' as const
                }
              ]
            }
          },
          unansweredQuestions: [],
          nextSteps: []
        };

  return {
    runId: overrides.runId,
    requestedSubjectName: overrides.requestedSubjectName,
    subjectKey: overrides.subjectKey ?? overrides.requestedSubjectName.toLowerCase(),
    canonicalSubjectName: overrides.canonicalSubjectName ?? overrides.requestedSubjectName,
    canonicalVendorName: overrides.canonicalVendorName ?? overrides.requestedSubjectName,
    officialDomains: overrides.officialDomains ?? ['example.com'],
    outcome: overrides.outcome ?? 'succeeded',
    recommendation: overrides.recommendation ?? 'green',
    euStatus: overrides.euStatus ?? 'supported',
    enterpriseStatus: overrides.enterpriseStatus ?? 'supported',
    cachePath: overrides.cachePath ?? {},
    phaseTimings: overrides.phaseTimings ?? { completedMs: 1000 },
    memoLength: overrides.memoLength ?? 1200,
    promotionResult: overrides.promotionResult ?? null,
    bundleId: overrides.bundleId ?? null,
    baselineBundleId: overrides.baselineBundleId ?? null,
    errorPhase: overrides.errorPhase ?? null,
    errorClass: overrides.errorClass ?? null,
    errorName: overrides.errorName ?? null,
    errorMessage: overrides.errorMessage ?? null,
    trace: {
      traceVersion: 1,
      runId: overrides.runId,
      requestedSubjectName: overrides.requestedSubjectName,
      subjectKey: overrides.subjectKey ?? overrides.requestedSubjectName.toLowerCase(),
      canonicalSubjectName: overrides.canonicalSubjectName ?? overrides.requestedSubjectName,
      canonicalVendorName: overrides.canonicalVendorName ?? overrides.requestedSubjectName,
      officialDomains: overrides.officialDomains ?? ['example.com'],
      outcome: overrides.outcome ?? 'succeeded',
      cachePath: overrides.cachePath ?? {},
      phaseTimings: overrides.phaseTimings ?? { completedMs: 1000 },
      memoLength: overrides.memoLength ?? 1200,
      recommendation: overrides.recommendation ?? 'green',
      guardrails: {
        euDataResidency: report
          ? {
              status: report.guardrails.euDataResidency.status,
              confidence: report.guardrails.euDataResidency.confidence,
              evidenceCount: report.guardrails.euDataResidency.evidence.length
            }
          : null,
        enterpriseDeployment: report
          ? {
              status: report.guardrails.enterpriseDeployment.status,
              confidence: report.guardrails.enterpriseDeployment.confidence,
              evidenceCount: report.guardrails.enterpriseDeployment.evidence.length
            }
          : null
      },
      promotionResult: overrides.promotionResult ?? null,
      bundleId: overrides.bundleId ?? null,
      baselineBundleId: overrides.baselineBundleId ?? null,
      error:
        overrides.outcome === 'failed'
          ? {
              phase: overrides.errorPhase ?? 'decision',
              errorClass: overrides.errorClass ?? 'ResearchDecisionError',
              errorName: overrides.errorName ?? 'ResearchDecisionError',
              errorMessage: overrides.errorMessage ?? 'Decision stage failed.'
            }
          : null,
      report,
      context: {
        backgroundRefresh: false,
        forceRefresh: false,
        streamed: false
      }
    },
    createdAt: overrides.createdAt
  };
}
