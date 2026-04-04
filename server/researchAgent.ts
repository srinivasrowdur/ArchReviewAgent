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
import { evaluateCandidateReport } from './research/cachePolicy.js';
import {
  createResearchRunId,
  describeError,
  logResearchEvent,
  summarizeInputForLog
} from './research/logging.js';
import { presentDecision } from './research/presentation.js';
import {
  loadAcceptedReportSnapshot,
  loadCachedVendorResolution,
  loadLatestAcceptedReportSnapshot,
  normalizeSubjectCacheKey,
  renewAcceptedReportSnapshot,
  storeResearchArtifacts,
  storeVendorResolution
} from './db/researchCacheRepository.js';
type ResearchProgressListener = (update: ResearchProgressUpdate) => void;
type ResearchWorkflowOptions = {
  onProgress?: ResearchProgressListener;
  forceRefresh?: boolean;
  skipAcceptedReportCache?: boolean;
  backgroundRefresh?: boolean;
  seededResolution?: Awaited<ReturnType<typeof resolveVendorIdentity>>;
};

const activeBackgroundRefreshes = new Set<string>();
const lastBackgroundRefreshAt = new Map<string, number>();

function getResearchTimeoutMs() {
  const parsed = Number(process.env.RESEARCH_TIMEOUT_MS ?? 180_000);

  if (!Number.isFinite(parsed) || parsed < 15_000) {
    return 180_000;
  }

  return parsed;
}

function getBackgroundRefreshCooldownMs() {
  const parsed = Number(process.env.BACKGROUND_REFRESH_COOLDOWN_MS ?? 600_000);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 600_000;
  }

  return parsed;
}

export async function researchCompany(
  companyName: string,
  options: {
    forceRefresh?: boolean;
    onProgress?: ResearchProgressListener;
  } = {}
) {
  return runResearchWorkflow(companyName, {
    forceRefresh: options.forceRefresh,
    onProgress: options.onProgress,
    skipAcceptedReportCache: options.forceRefresh
  });
}

async function runResearchWorkflow(
  rawCompanyName: string,
  options: ResearchWorkflowOptions = {}
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
    | null
    | undefined;
  let resolutionSource: 'cache' | 'live' | 'seed' = 'live';
  let memo = '';
  let decision:
    | Awaited<ReturnType<typeof buildDecisionFromMemo>>
    | undefined;
  let acceptedSubjectKey = '';
  let baselineSnapshot:
    | Awaited<ReturnType<typeof loadLatestAcceptedReportSnapshot>>
    | undefined;

  try {
    companyName = validateVendorInput(rawCompanyName);
    logResearchEvent('research_started', {
      runId,
      companyName,
      budgetMs,
      streamed: Boolean(options.onProgress),
      backgroundRefresh: Boolean(options.backgroundRefresh),
      forceRefresh: Boolean(options.forceRefresh)
    });
    phase = 'resolution';
    resolution = options.seededResolution ?? (await tryLoadCachedVendorResolution(runId, companyName));

    if (resolution) {
      resolutionSource = options.seededResolution ? 'seed' : 'cache';
    } else {
      resolution = await resolveVendorIdentity(companyName, startedAt, budgetMs);
      await tryStoreVendorResolution(runId, companyName, resolution);
    }

    acceptedSubjectKey = normalizeSubjectCacheKey(resolution.canonicalName);

    logResearchEvent('vendor_resolved', {
      runId,
      companyName,
      canonicalName: resolution.canonicalName,
      officialDomains: resolution.officialDomains,
      resolutionConfidence: resolution.confidence,
      alternatives: resolution.alternatives,
      resolutionSource,
      elapsedMs: Date.now() - startedAt
    });

    const cachedReport = options.skipAcceptedReportCache
      ? null
      : await tryLoadAcceptedReportSnapshot(runId, companyName, acceptedSubjectKey);

    if (cachedReport) {
      logResearchEvent('report_cache_hit', {
        runId,
        subjectName: companyName,
        canonicalName: resolution.canonicalName,
        bundleId: cachedReport.bundleId,
        cachedAt: cachedReport.fetchedAt
      });
      maybeStartBackgroundRefresh(runId, companyName, acceptedSubjectKey, resolution, cachedReport);

      return cachedReport.report;
    }

    baselineSnapshot = await tryLoadLatestAcceptedReportSnapshot(
      runId,
      companyName,
      acceptedSubjectKey
    );

    phase = 'retrieval';
    memo = await generateResearchMemo(
      companyName,
      resolution,
      startedAt,
      budgetMs,
      options.onProgress
    );
    logResearchEvent('memo_generated', {
      subjectName: companyName,
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
      companyName,
      memo,
      resolution,
      startedAt,
      budgetMs
    );
    logResearchEvent('decision_built', {
      runId,
      subjectName: companyName,
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
    const candidateReport = presentDecision(decision);
    const promotionDecision = evaluateCandidateReport(
      candidateReport,
      baselineSnapshot?.report ?? null
    );
    logResearchEvent('candidate_cache_evaluated', {
      runId,
      subjectName: companyName,
      baselineBundleId: baselineSnapshot?.bundleId,
      promoteCandidate: promotionDecision.promoteCandidate,
      promotionReason: promotionDecision.reason,
      promotionDetail: promotionDecision.detail
    });
    const storedArtifacts = await tryStoreResearchArtifacts(runId, {
      subjectKey: acceptedSubjectKey,
      requestedSubjectName: companyName,
      resolution,
      memo,
      report: candidateReport,
      statusOverride: promotionDecision.promoteCandidate ? 'accepted' : 'weak'
    });
    const report = promotionDecision.promoteCandidate
      ? candidateReport
      : await tryReuseBaselineReport(runId, companyName, baselineSnapshot, candidateReport);
    logResearchEvent('report_presented', {
      runId,
      subjectName: companyName,
      canonicalName: report.companyName,
      recommendation: report.recommendation,
      euStatus: report.guardrails.euDataResidency.status,
      deploymentStatus: report.guardrails.enterpriseDeployment.status,
      unansweredQuestionCount: report.unansweredQuestions.length,
      nextStepCount: report.nextSteps.length,
      bundleId: storedArtifacts?.bundleId,
      bundleStatus: storedArtifacts?.status,
      promotionReason: promotionDecision.reason,
      promotionDetail: promotionDecision.detail,
      backgroundRefresh: Boolean(options.backgroundRefresh),
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
      backgroundRefresh: Boolean(options.backgroundRefresh),
      elapsedMs: Date.now() - startedAt,
      ...describeError(error)
    });
    throw error;
  }
}

function maybeStartBackgroundRefresh(
  runId: string,
  requestedSubjectName: string,
  subjectKey: string,
  resolution: Awaited<ReturnType<typeof resolveVendorIdentity>>,
  cachedReport: Awaited<ReturnType<typeof loadAcceptedReportSnapshot>>
) {
  const cooldownMs = getBackgroundRefreshCooldownMs();
  const now = Date.now();
  const lastStartedAt = lastBackgroundRefreshAt.get(subjectKey) ?? 0;

  if (activeBackgroundRefreshes.has(subjectKey)) {
    logResearchEvent('background_refresh_skipped', {
      runId,
      subjectName: requestedSubjectName,
      canonicalName: resolution.canonicalName,
      subjectKey,
      reason: 'already_running'
    });
    return;
  }

  if (now - lastStartedAt < cooldownMs) {
    logResearchEvent('background_refresh_skipped', {
      runId,
      subjectName: requestedSubjectName,
      canonicalName: resolution.canonicalName,
      subjectKey,
      reason: 'cooldown_active',
      cooldownMs
    });
    return;
  }

  activeBackgroundRefreshes.add(subjectKey);
  lastBackgroundRefreshAt.set(subjectKey, now);

  logResearchEvent('background_refresh_scheduled', {
    runId,
    subjectName: requestedSubjectName,
    canonicalName: resolution.canonicalName,
    subjectKey,
    bundleId: cachedReport?.bundleId,
    cachedAt: cachedReport?.fetchedAt
  });

  setTimeout(() => {
    void runResearchWorkflow(requestedSubjectName, {
      skipAcceptedReportCache: true,
      backgroundRefresh: true,
      seededResolution: resolution
    })
      .then((report) => {
        logResearchEvent('background_refresh_completed', {
          runId,
          subjectName: requestedSubjectName,
          canonicalName: report.companyName,
          subjectKey,
          recommendation: report.recommendation
        });
      })
      .catch((error) => {
        logResearchEvent('background_refresh_failed', {
          runId,
          subjectName: requestedSubjectName,
          canonicalName: resolution.canonicalName,
          subjectKey,
          ...describeError(error)
        });
      })
      .finally(() => {
        activeBackgroundRefreshes.delete(subjectKey);
      });
  }, 0);
}

async function tryLoadAcceptedReportSnapshot(
  runId: string,
  companyName: string,
  subjectKey: string
) {
  try {
    return await loadAcceptedReportSnapshot(subjectKey);
  } catch (error) {
    logResearchEvent('cache_read_failed', {
      runId,
      companyName,
      cacheLayer: 'report',
      ...describeError(error)
    });

    return null;
  }
}

async function tryLoadCachedVendorResolution(runId: string, companyName: string) {
  try {
    return await loadCachedVendorResolution(companyName);
  } catch (error) {
    logResearchEvent('cache_read_failed', {
      runId,
      companyName,
      cacheLayer: 'resolution',
      ...describeError(error)
    });

    return null;
  }
}

async function tryLoadLatestAcceptedReportSnapshot(
  runId: string,
  companyName: string,
  subjectKey?: string
) {
  if (!subjectKey) {
    return null;
  }

  try {
    return await loadLatestAcceptedReportSnapshot(subjectKey);
  } catch (error) {
    logResearchEvent('cache_read_failed', {
      runId,
      companyName,
      cacheLayer: 'baseline_report',
      ...describeError(error)
    });

    return null;
  }
}

async function tryStoreVendorResolution(
  runId: string,
  companyName: string,
  resolution: Awaited<ReturnType<typeof resolveVendorIdentity>>
) {
  try {
    await storeVendorResolution(companyName, resolution);
  } catch (error) {
    logResearchEvent('cache_write_failed', {
      runId,
      companyName,
      cacheLayer: 'resolution',
      canonicalName: resolution.canonicalName,
      ...describeError(error)
    });
  }
}

async function tryStoreResearchArtifacts(
  runId: string,
  input: {
    subjectKey: string;
    requestedSubjectName: string;
    resolution: Awaited<ReturnType<typeof resolveVendorIdentity>>;
    memo: string;
    report: Awaited<ReturnType<typeof presentDecision>>;
    statusOverride?: 'accepted' | 'weak' | 'stale';
  }
) {
  try {
    return await storeResearchArtifacts(input);
  } catch (error) {
    logResearchEvent('cache_write_failed', {
      runId,
      companyName: input.requestedSubjectName,
      cacheLayer: 'artifacts',
      canonicalName: input.resolution.canonicalName,
      ...describeError(error)
    });

    return null;
  }
}

async function tryReuseBaselineReport(
  runId: string,
  companyName: string,
  baselineSnapshot: Awaited<ReturnType<typeof loadLatestAcceptedReportSnapshot>> | undefined,
  candidateReport: Awaited<ReturnType<typeof presentDecision>>
) {
  if (!baselineSnapshot) {
    return candidateReport;
  }

  try {
    await renewAcceptedReportSnapshot(baselineSnapshot.bundleId);
    logResearchEvent('report_cache_retained', {
      runId,
      subjectName: companyName,
      bundleId: baselineSnapshot.bundleId,
      cachedAt: baselineSnapshot.fetchedAt
    });
  } catch (error) {
    logResearchEvent('cache_write_failed', {
      runId,
      companyName,
      cacheLayer: 'baseline_report_renewal',
      bundleId: baselineSnapshot.bundleId,
      ...describeError(error)
    });
  }

  return baselineSnapshot.report;
}

export {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
};
