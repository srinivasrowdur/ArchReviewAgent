import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockReport } from '../mockReport.js';
import {
  buildApiRequestMetricPayload,
  buildBackgroundRefreshMetricPayload,
  buildResearchRunMetricPayload
} from './metrics.js';

test('buildResearchRunMetricPayload captures cache hits, unknowns, and recommendation drift', () => {
  const report = createMockReport('Miro');
  report.recommendation = 'green';
  report.guardrails.euDataResidency.status = 'unknown';

  const metric = buildResearchRunMetricPayload({
    runId: 'abc12345',
    requestedSubjectName: 'Miro',
    subjectKey: 'miro',
    canonicalSubjectName: 'Miro',
    canonicalVendorName: 'Miro',
    outcome: 'succeeded',
    report,
    previousRecommendation: 'yellow',
    phaseTimings: {
      resolutionCompletedMs: 400,
      memoGeneratedMs: 3200,
      completedMs: 5100
    },
    cachePath: {
      acceptedReportCache: 'hit',
      resolutionSource: 'cache'
    }
  });

  assert.equal(metric.cacheHit, true);
  assert.equal(metric.recommendationChanged, true);
  assert.equal(metric.totalDurationMs, 5100);
  assert.deepEqual(metric.unknownGuardrails, ['euDataResidency']);
  assert.equal(metric.unknownGuardrailCount, 1);
  assert.equal(metric.timeout, false);
});

test('buildResearchRunMetricPayload marks timeout failures', () => {
  const metric = buildResearchRunMetricPayload({
    runId: 'def67890',
    requestedSubjectName: 'Palantir',
    outcome: 'failed',
    previousRecommendation: 'yellow',
    phaseTimings: {
      failedMs: 180000
    },
    cachePath: {
      acceptedReportCache: 'miss'
    },
    error: {
      phase: 'decision',
      errorClass: 'ResearchTimeoutError',
      errorName: 'ResearchTimeoutError'
    }
  });

  assert.equal(metric.timeout, true);
  assert.equal(metric.totalDurationMs, 180000);
  assert.equal(metric.errorPhase, 'decision');
});

test('buildBackgroundRefreshMetricPayload normalizes refresh metric fields', () => {
  const metric = buildBackgroundRefreshMetricPayload({
    runId: 'run12345',
    subjectName: 'Grammarly',
    subjectKey: 'grammarly',
    canonicalName: 'Grammarly',
    state: 'skipped',
    reason: 'cooldown_active',
    cooldownMs: 600000
  });

  assert.equal(metric.state, 'skipped');
  assert.equal(metric.reason, 'cooldown_active');
  assert.equal(metric.cooldownMs, 600000);
});

test('buildApiRequestMetricPayload captures status and timeout fields', () => {
  const metric = buildApiRequestMetricPayload({
    route: '/api/chat',
    transport: 'json',
    status: 504,
    result: 'server_error',
    durationMs: 90000,
    refresh: true,
    requestedSubjectName: 'Databricks',
    timeout: true,
    errorClass: 'ResearchTimeoutError'
  });

  assert.equal(metric.status, 504);
  assert.equal(metric.timeout, true);
  assert.equal(metric.result, 'server_error');
  assert.equal(metric.requestedSubjectName, 'Databricks');
});
