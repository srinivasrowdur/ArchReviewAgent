import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchRunTracePayload } from './traceArtifacts.js';
import type { EnterpriseReadinessReport } from '../../shared/contracts.js';

const sampleReport: EnterpriseReadinessReport = {
  companyName: 'Microsoft Fabric',
  researchedAt: '2026-04-08T21:00:00.000Z',
  overview: 'Analytics product.',
  executiveSummary: 'Summary.',
  recommendation: 'yellow',
  deploymentVerdict: 'Verdict.',
  guardrails: {
    euDataResidency: {
      status: 'partial',
      confidence: 'medium',
      summary: 'EU summary.',
      risks: ['Risk'],
      evidence: [
        {
          title: 'EU evidence',
          url: 'https://example.com/eu',
          publisher: 'Example',
          finding: 'EU finding.',
          sourceType: 'primary'
        }
      ]
    },
    enterpriseDeployment: {
      status: 'supported',
      confidence: 'high',
      summary: 'Deployment summary.',
      risks: ['Risk'],
      evidence: [
        {
          title: 'Deployment evidence',
          url: 'https://example.com/deploy',
          publisher: 'Example',
          finding: 'Deployment finding.',
          sourceType: 'primary'
        }
      ]
    }
  },
  unansweredQuestions: ['Question'],
  nextSteps: ['Step']
};

test('buildResearchRunTracePayload captures success fields needed for shadow grading', () => {
  const trace = buildResearchRunTracePayload({
    runId: 'abc12345',
    requestedSubjectName: 'Microsoft Fabric',
    subjectKey: 'microsoft',
    canonicalSubjectName: 'Microsoft Fabric',
    canonicalVendorName: 'Microsoft',
    officialDomains: ['microsoft.com', 'fabric.microsoft.com'],
    outcome: 'succeeded',
    cachePath: {
      resolutionSource: 'cache',
      acceptedReportCache: 'hit'
    },
    phaseTimings: {
      resolutionCompletedMs: 22,
      cacheHitMs: 31,
      completedMs: 31
    },
    memoLength: 1800,
    report: sampleReport,
    promotionResult: {
      promotedCandidate: false,
      reason: 'accepted_cache_hit',
      detail: 'bundle_1'
    },
    bundleId: 'bundle_1',
    baselineBundleId: 'bundle_1',
    backgroundRefresh: true,
    forceRefresh: false,
    streamed: true
  });

  assert.equal(trace.recommendation, 'yellow');
  assert.equal(trace.guardrails.euDataResidency?.status, 'partial');
  assert.equal(trace.guardrails.enterpriseDeployment?.evidenceCount, 1);
  assert.equal(trace.promotionResult?.reason, 'accepted_cache_hit');
  assert.equal(trace.error, null);
});

test('buildResearchRunTracePayload captures failure fields without a report', () => {
  const trace = buildResearchRunTracePayload({
    runId: 'def67890',
    requestedSubjectName: 'a',
    outcome: 'failed',
    memoLength: 0,
    phaseTimings: {
      failedMs: 12
    },
    error: {
      phase: 'intake',
      errorClass: 'InvalidVendorInputError',
      errorName: 'InvalidVendorInputError',
      errorMessage: 'Enter a company or product name to research.'
    }
  });

  assert.equal(trace.report, null);
  assert.equal(trace.recommendation, null);
  assert.equal(trace.error?.phase, 'intake');
  assert.equal(trace.phaseTimings.failedMs, 12);
});
