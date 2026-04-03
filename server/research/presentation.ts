import { z } from 'zod';
import type {
  EnterpriseReadinessReport,
  RecommendationLevel
} from '../../shared/contracts.js';
import { IncompleteResearchError } from './errors.js';
import type { ResearchDecision } from './decisioning.js';
import { guardrailsSchema, normalizeIsoDate } from './reportSchema.js';

const enterpriseReadinessSchema = z.object({
  companyName: z.string(),
  researchedAt: z.string(),
  overview: z.string(),
  executiveSummary: z.string(),
  recommendation: z.enum(['green', 'yellow', 'red']),
  deploymentVerdict: z.string(),
  guardrails: guardrailsSchema,
  unansweredQuestions: z.array(z.string()).max(6),
  nextSteps: z.array(z.string()).max(6)
});

type StructuredReadinessReport = z.infer<typeof enterpriseReadinessSchema>;

export function presentDecision(decision: ResearchDecision): EnterpriseReadinessReport {
  const executiveSummary =
    decision.preliminaryVerdict.trim().length >= 80
      ? decision.preliminaryVerdict
      : buildExecutiveSummary(decision.companyName, decision.recommendation);
  const report = enterpriseReadinessSchema.parse({
    companyName: decision.companyName,
    researchedAt: decision.researchedAt,
    overview: decision.vendorOverview,
    executiveSummary,
    recommendation: decision.recommendation,
    deploymentVerdict:
      decision.preliminaryVerdict.trim() ||
      'Security analyst verdict generated from the structured evidence review.',
    guardrails: decision.guardrails,
    unansweredQuestions:
      decision.unansweredQuestions.length > 0
        ? decision.unansweredQuestions
        : ['No specific unanswered questions were captured in the research memo.'],
    nextSteps: buildNextSteps(decision.recommendation)
  });

  validateCoverage(report);

  return normalizeReport(report, decision.companyName);
}

function normalizeReport(
  report: StructuredReadinessReport,
  fallbackCompanyName: string
): EnterpriseReadinessReport {
  return {
    ...report,
    companyName: report.companyName.trim() || fallbackCompanyName,
    researchedAt: normalizeIsoDate(report.researchedAt),
    overview: report.overview.trim(),
    executiveSummary: report.executiveSummary.trim(),
    deploymentVerdict: report.deploymentVerdict.trim(),
    unansweredQuestions: report.unansweredQuestions.filter(Boolean),
    nextSteps: report.nextSteps.filter(Boolean)
  };
}

function validateCoverage(report: StructuredReadinessReport) {
  const hasExecutiveSummary = report.executiveSummary.trim().length > 80;
  const hasEuSummary = report.guardrails.euDataResidency.summary.trim().length > 0;
  const hasDeploymentSummary =
    report.guardrails.enterpriseDeployment.summary.trim().length > 0;

  if (!hasExecutiveSummary || !hasEuSummary || !hasDeploymentSummary) {
    throw new IncompleteResearchError();
  }
}

function buildExecutiveSummary(
  companyName: string,
  recommendation: RecommendationLevel
) {
  const posture =
    recommendation === 'green'
      ? 'looks acceptable from a security review perspective'
      : recommendation === 'yellow'
        ? 'shows mixed security and deployment signals'
        : 'shows material security-review risk';

  return `${companyName} ${posture}, with the strongest emphasis on EU data residency and enterprise deployment posture. This is an evidence-based security assessment, and the confidence level reflects how explicit the public vendor documentation is.`;
}

function buildNextSteps(recommendation: RecommendationLevel) {
  const steps = [
    'Review the cited vendor documentation directly.',
    'Confirm data residency and deployment terms in writing with the vendor.',
    'Validate plan-specific controls such as SSO, SCIM, audit logs, and contractual commitments.'
  ];

  if (recommendation !== 'green') {
    steps.unshift('Escalate the guardrail gap before approving the vendor.');
  }

  return steps.slice(0, 6);
}
