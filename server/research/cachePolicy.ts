import type { EnterpriseReadinessReport } from '../../shared/contracts.js';

export type CachePromotionDecision = {
  promoteCandidate: boolean;
  reason:
    | 'no_baseline'
    | 'baseline_missing'
    | 'candidate_unknown'
    | 'candidate_missing_evidence'
    | 'evidence_count_regressed'
    | 'no_overlap_with_baseline'
    | 'candidate_coverage_acceptable';
  detail?: string;
};

export function evaluateCandidateReport(
  candidate: EnterpriseReadinessReport,
  baseline?: EnterpriseReadinessReport | null
): CachePromotionDecision {
  const minimumCoverageFailure = evaluateMinimumAcceptedCoverage(candidate);

  if (minimumCoverageFailure) {
    return minimumCoverageFailure;
  }

  if (!baseline) {
    return {
      promoteCandidate: true,
      reason: 'no_baseline'
    };
  }

  const candidateAssessments = [
    ['euDataResidency', candidate.guardrails.euDataResidency],
    ['enterpriseDeployment', candidate.guardrails.enterpriseDeployment]
  ] as const;
  const baselineAssessments = [
    ['euDataResidency', baseline.guardrails.euDataResidency],
    ['enterpriseDeployment', baseline.guardrails.enterpriseDeployment]
  ] as const;

  for (const [guardrailKey, candidateAssessment] of candidateAssessments) {
    const baselineAssessment = baselineAssessments.find(([key]) => key === guardrailKey)?.[1];

    if (!baselineAssessment) {
      return {
        promoteCandidate: true,
        reason: 'baseline_missing',
        detail: guardrailKey
      };
    }

    if (candidateAssessment.status === 'unknown') {
      return {
        promoteCandidate: false,
        reason: 'candidate_unknown',
        detail: guardrailKey
      };
    }

    const candidateUrls = getUniqueEvidenceUrls(candidateAssessment.evidence);
    const baselineUrls = getUniqueEvidenceUrls(baselineAssessment.evidence);

    if (candidateUrls.size < baselineUrls.size) {
      return {
        promoteCandidate: false,
        reason: 'evidence_count_regressed',
        detail: guardrailKey
      };
    }

    if (baselineUrls.size > 0 && countUrlOverlap(candidateUrls, baselineUrls) === 0) {
      return {
        promoteCandidate: false,
        reason: 'no_overlap_with_baseline',
        detail: guardrailKey
      };
    }
  }

  return {
    promoteCandidate: true,
    reason: 'candidate_coverage_acceptable'
  };
}

function evaluateMinimumAcceptedCoverage(
  candidate: EnterpriseReadinessReport
): CachePromotionDecision | null {
  const candidateAssessments = [
    ['euDataResidency', candidate.guardrails.euDataResidency],
    ['enterpriseDeployment', candidate.guardrails.enterpriseDeployment]
  ] as const;

  for (const [guardrailKey, candidateAssessment] of candidateAssessments) {
    if (candidateAssessment.status === 'unknown') {
      return {
        promoteCandidate: false,
        reason: 'candidate_unknown',
        detail: guardrailKey
      };
    }

    if (getUniqueEvidenceUrls(candidateAssessment.evidence).size === 0) {
      return {
        promoteCandidate: false,
        reason: 'candidate_missing_evidence',
        detail: guardrailKey
      };
    }
  }

  return null;
}

function getUniqueEvidenceUrls(
  evidence: EnterpriseReadinessReport['guardrails']['euDataResidency']['evidence']
) {
  return new Set(
    evidence
      .map((item) => item.url.trim())
      .filter(Boolean)
  );
}

function countUrlOverlap(candidateUrls: Set<string>, baselineUrls: Set<string>) {
  let overlap = 0;

  for (const url of candidateUrls) {
    if (baselineUrls.has(url)) {
      overlap += 1;
    }
  }

  return overlap;
}
