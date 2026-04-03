import {
  resolveVendorIdentity,
  validateVendorInput
} from './research/vendorIntake.js';
import {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
} from './research/errors.js';
import { generateResearchMemo } from './research/retrieval.js';
import { type ResearchProgressUpdate } from '../shared/contracts.js';
import { buildDecisionFromMemo } from './research/decisioning.js';
import {
  createResearchRunId,
  describeError,
  logResearchEvent,
  summarizeInputForLog
} from './research/logging.js';
import { presentDecision } from './research/presentation.js';
type ResearchProgressListener = (update: ResearchProgressUpdate) => void;

function getResearchTimeoutMs() {
  const parsed = Number(process.env.RESEARCH_TIMEOUT_MS ?? 180_000);

  if (!Number.isFinite(parsed) || parsed < 15_000) {
    return 180_000;
  }

  return parsed;
}

export async function researchCompany(companyName: string) {
  return runResearchWorkflow(companyName);
}

export async function researchCompanyStream(
  companyName: string,
  onProgress?: ResearchProgressListener
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new MissingOpenAIKeyError();
  }

  return runResearchWorkflow(companyName, onProgress);
}

async function runResearchWorkflow(
  rawCompanyName: string,
  onProgress?: ResearchProgressListener
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new MissingOpenAIKeyError();
  }

  const runId = createResearchRunId();
  const startedAt = Date.now();
  const budgetMs = getResearchTimeoutMs();
  let phase = 'intake';
  let companyName = rawCompanyName.trim();
  let resolution:
    | Awaited<ReturnType<typeof resolveVendorIdentity>>
    | undefined;
  let memo = '';
  let decision:
    | Awaited<ReturnType<typeof buildDecisionFromMemo>>
    | undefined;

  try {
    companyName = validateVendorInput(rawCompanyName);
    logResearchEvent('research_started', {
      runId,
      companyName,
      budgetMs,
      streamed: Boolean(onProgress)
    });

    phase = 'resolution';
    resolution = await resolveVendorIdentity(companyName, startedAt, budgetMs);
    logResearchEvent('vendor_resolved', {
      runId,
      companyName,
      canonicalName: resolution.canonicalName,
      officialDomains: resolution.officialDomains,
      resolutionConfidence: resolution.confidence,
      alternatives: resolution.alternatives,
      elapsedMs: Date.now() - startedAt
    });

    phase = 'retrieval';
    memo = await generateResearchMemo(resolution, startedAt, budgetMs, onProgress);
    logResearchEvent('memo_generated', {
      runId,
      canonicalName: resolution.canonicalName,
      memoLength: memo.length,
      hasPreliminaryVerdict: /preliminary verdict/i.test(memo),
      hasEuSection: /eu data residency/i.test(memo),
      hasDeploymentSection: /enterprise deployment/i.test(memo),
      elapsedMs: Date.now() - startedAt
    });

    phase = 'decision';
    decision = await buildDecisionFromMemo(
      resolution.canonicalName,
      memo,
      resolution,
      startedAt,
      budgetMs
    );
    logResearchEvent('decision_built', {
      runId,
      canonicalName: decision.companyName,
      recommendation: decision.recommendation,
      euStatus: decision.guardrails.euDataResidency.status,
      euConfidence: decision.guardrails.euDataResidency.confidence,
      euEvidenceCount: decision.guardrails.euDataResidency.evidence.length,
      deploymentStatus: decision.guardrails.enterpriseDeployment.status,
      deploymentConfidence: decision.guardrails.enterpriseDeployment.confidence,
      deploymentEvidenceCount: decision.guardrails.enterpriseDeployment.evidence.length,
      unansweredQuestionCount: decision.unansweredQuestions.length,
      preliminaryVerdictLength: decision.preliminaryVerdict.length,
      elapsedMs: Date.now() - startedAt
    });

    phase = 'presentation';
    const report = presentDecision(decision);
    logResearchEvent('report_presented', {
      runId,
      canonicalName: report.companyName,
      recommendation: report.recommendation,
      euStatus: report.guardrails.euDataResidency.status,
      deploymentStatus: report.guardrails.enterpriseDeployment.status,
      unansweredQuestionCount: report.unansweredQuestions.length,
      nextStepCount: report.nextSteps.length,
      elapsedMs: Date.now() - startedAt
    });

    return report;
  } catch (error) {
    const inputSummary = summarizeInputForLog(rawCompanyName);

    logResearchEvent('research_failed', {
      runId,
      phase,
      companyName: phase === 'intake' ? inputSummary.preview : companyName,
      companyNameLength: inputSummary.length,
      canonicalName: resolution?.canonicalName,
      officialDomains: resolution?.officialDomains,
      memoLength: memo.length,
      decisionRecommendation: decision?.recommendation,
      euStatus: decision?.guardrails.euDataResidency.status,
      deploymentStatus: decision?.guardrails.enterpriseDeployment.status,
      elapsedMs: Date.now() - startedAt,
      ...describeError(error)
    });
    throw error;
  }
}

export {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
};
