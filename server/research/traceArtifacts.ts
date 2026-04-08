import type {
  ConfidenceLevel,
  EnterpriseReadinessReport,
  RecommendationLevel,
  ReadinessStatus
} from '../../shared/contracts.js';

export type GuardrailTraceSummary = {
  status: ReadinessStatus;
  confidence: ConfidenceLevel;
  evidenceCount: number;
};

export type ResearchRunTracePayload = {
  traceVersion: 1;
  runId: string;
  requestedSubjectName: string;
  subjectKey: string | null;
  canonicalSubjectName: string | null;
  canonicalVendorName: string | null;
  officialDomains: string[];
  outcome: 'succeeded' | 'failed';
  cachePath: Record<string, unknown>;
  phaseTimings: Record<string, number>;
  memoLength: number;
  recommendation: RecommendationLevel | null;
  guardrails: {
    euDataResidency: GuardrailTraceSummary | null;
    enterpriseDeployment: GuardrailTraceSummary | null;
  };
  promotionResult: {
    promotedCandidate: boolean;
    reason: string;
    detail: string | null;
  } | null;
  bundleId: string | null;
  baselineBundleId: string | null;
  error: {
    phase: string;
    errorClass: string;
    errorName: string;
    errorMessage: string;
  } | null;
  report: EnterpriseReadinessReport | null;
  context: {
    backgroundRefresh: boolean;
    forceRefresh: boolean;
    streamed: boolean;
  };
};

export function buildResearchRunTracePayload(input: {
  runId: string;
  requestedSubjectName: string;
  subjectKey?: string | null;
  canonicalSubjectName?: string | null;
  canonicalVendorName?: string | null;
  officialDomains?: string[] | null;
  outcome: 'succeeded' | 'failed';
  cachePath?: Record<string, unknown>;
  phaseTimings?: Record<string, number | undefined>;
  memoLength?: number;
  report?: EnterpriseReadinessReport | null;
  promotionResult?: {
    promotedCandidate: boolean;
    reason: string;
    detail?: string | null;
  } | null;
  bundleId?: string | null;
  baselineBundleId?: string | null;
  error?: {
    phase: string;
    errorClass: string;
    errorName: string;
    errorMessage: string;
  } | null;
  backgroundRefresh?: boolean;
  forceRefresh?: boolean;
  streamed?: boolean;
}): ResearchRunTracePayload {
  const report = input.report ?? null;

  return {
    traceVersion: 1,
    runId: input.runId,
    requestedSubjectName: input.requestedSubjectName,
    subjectKey: input.subjectKey ?? null,
    canonicalSubjectName: input.canonicalSubjectName ?? report?.companyName ?? null,
    canonicalVendorName: input.canonicalVendorName ?? null,
    officialDomains: input.officialDomains ?? [],
    outcome: input.outcome,
    cachePath: input.cachePath ?? {},
    phaseTimings: normalizePhaseTimings(input.phaseTimings),
    memoLength: Math.max(0, input.memoLength ?? 0),
    recommendation: report?.recommendation ?? null,
    guardrails: summarizeGuardrails(report),
    promotionResult: input.promotionResult
      ? {
          promotedCandidate: input.promotionResult.promotedCandidate,
          reason: input.promotionResult.reason,
          detail: input.promotionResult.detail ?? null
        }
      : null,
    bundleId: input.bundleId ?? null,
    baselineBundleId: input.baselineBundleId ?? null,
    error: input.error ?? null,
    report,
    context: {
      backgroundRefresh: Boolean(input.backgroundRefresh),
      forceRefresh: Boolean(input.forceRefresh),
      streamed: Boolean(input.streamed)
    }
  };
}

function normalizePhaseTimings(
  phaseTimings: Record<string, number | undefined> | undefined
) {
  if (!phaseTimings) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(phaseTimings).filter(
      (entry): entry is [string, number] =>
        Number.isFinite(entry[1]) && (entry[1] ?? 0) >= 0
    )
  );
}

function summarizeGuardrails(report: EnterpriseReadinessReport | null) {
  if (!report) {
    return {
      euDataResidency: null,
      enterpriseDeployment: null
    };
  }

  return {
    euDataResidency: {
      status: report.guardrails.euDataResidency.status,
      confidence: report.guardrails.euDataResidency.confidence,
      evidenceCount: report.guardrails.euDataResidency.evidence.length
    },
    enterpriseDeployment: {
      status: report.guardrails.enterpriseDeployment.status,
      confidence: report.guardrails.enterpriseDeployment.confidence,
      evidenceCount: report.guardrails.enterpriseDeployment.evidence.length
    }
  };
}
