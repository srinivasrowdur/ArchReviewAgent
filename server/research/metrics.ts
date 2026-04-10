import type { EnterpriseReadinessReport } from '../../shared/contracts.js';

export function buildResearchRunMetricPayload(input: {
  runId: string;
  requestedSubjectName: string;
  subjectKey?: string | null;
  canonicalSubjectName?: string | null;
  canonicalVendorName?: string | null;
  outcome: 'succeeded' | 'failed';
  report?: EnterpriseReadinessReport | null;
  previousRecommendation?: string | null;
  phaseTimings?: Record<string, number>;
  cachePath?: Record<string, unknown>;
  error?: {
    phase?: string | null;
    errorClass?: string | null;
    errorName?: string | null;
  } | null;
  backgroundRefresh?: boolean;
  forceRefresh?: boolean;
  streamed?: boolean;
}) {
  const report = input.report ?? null;
  const previousRecommendation = input.previousRecommendation ?? null;
  const currentRecommendation = report?.recommendation ?? null;
  const unknownGuardrails = collectUnknownGuardrails(report);
  const totalDurationMs = deriveTotalDurationMs(input.phaseTimings ?? {});
  const acceptedReportCache = normalizeStringField(input.cachePath?.acceptedReportCache);
  const resolutionSource = normalizeStringField(input.cachePath?.resolutionSource);

  return {
    runId: input.runId,
    requestedSubjectName: input.requestedSubjectName,
    subjectKey: input.subjectKey ?? null,
    canonicalSubjectName: input.canonicalSubjectName ?? report?.companyName ?? null,
    canonicalVendorName: input.canonicalVendorName ?? null,
    outcome: input.outcome,
    recommendation: currentRecommendation,
    previousRecommendation,
    recommendationChanged:
      Boolean(previousRecommendation) && previousRecommendation !== currentRecommendation,
    unknownGuardrails,
    unknownGuardrailCount: unknownGuardrails.length,
    acceptedReportCache,
    cacheHit: acceptedReportCache === 'hit',
    resolutionSource,
    backgroundRefresh: Boolean(input.backgroundRefresh),
    forceRefresh: Boolean(input.forceRefresh),
    streamed: Boolean(input.streamed),
    timeout: input.error?.errorClass === 'ResearchTimeoutError',
    errorPhase: input.error?.phase ?? null,
    errorClass: input.error?.errorClass ?? null,
    errorName: input.error?.errorName ?? null,
    totalDurationMs,
    phaseTimings: input.phaseTimings ?? {}
  };
}

export function buildBackgroundRefreshMetricPayload(input: {
  runId: string;
  subjectName: string;
  subjectKey: string;
  canonicalName: string;
  state: 'scheduled' | 'completed' | 'failed' | 'skipped';
  reason?: string | null;
  cooldownMs?: number | null;
  elapsedMs?: number | null;
  errorClass?: string | null;
}) {
  return {
    runId: input.runId,
    subjectName: input.subjectName,
    subjectKey: input.subjectKey,
    canonicalName: input.canonicalName,
    state: input.state,
    reason: input.reason ?? null,
    cooldownMs: input.cooldownMs ?? null,
    elapsedMs: input.elapsedMs ?? null,
    errorClass: input.errorClass ?? null
  };
}

export function buildApiRequestMetricPayload(input: {
  route: '/api/chat' | '/api/chat/stream';
  transport: 'json' | 'sse';
  method?: string;
  status: number;
  result:
    | 'success'
    | 'client_error'
    | 'server_error'
    | 'stream_error'
    | 'stream_disconnected';
  durationMs: number;
  refresh: boolean;
  requestedSubjectName?: string;
  timeout?: boolean;
  reportedStatus?: number | null;
  errorClass?: string | null;
}) {
  return {
    route: input.route,
    transport: input.transport,
    method: input.method ?? 'POST',
    status: input.status,
    reportedStatus: input.reportedStatus ?? null,
    result: input.result,
    durationMs: input.durationMs,
    refresh: input.refresh,
    requestedSubjectName: input.requestedSubjectName?.trim() || null,
    timeout: Boolean(input.timeout),
    errorClass: input.errorClass ?? null
  };
}

function collectUnknownGuardrails(report: EnterpriseReadinessReport | null) {
  if (!report) {
    return [];
  }

  const unknowns: string[] = [];

  if (report.guardrails.euDataResidency.status === 'unknown') {
    unknowns.push('euDataResidency');
  }

  if (report.guardrails.enterpriseDeployment.status === 'unknown') {
    unknowns.push('enterpriseDeployment');
  }

  return unknowns;
}

function deriveTotalDurationMs(phaseTimings: Record<string, number>) {
  const explicit =
    phaseTimings.completedMs ??
    phaseTimings.failedMs ??
    phaseTimings.reportPresentedMs ??
    phaseTimings.decisionBuiltMs ??
    phaseTimings.memoGeneratedMs ??
    phaseTimings.resolutionCompletedMs;

  if (Number.isFinite(explicit)) {
    return explicit;
  }

  return 0;
}

function normalizeStringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}
