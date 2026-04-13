import {
  resolveVendorIdentity,
  validateVendorInput
} from './research/vendorIntake.js';
import {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchDecisionError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
} from './research/errors.js';
import { generateResearchMemo } from './research/retrieval.js';
import {
  type ResearchActivityUpdate,
  liveResearchStages,
  type ResearchProgressUpdate
} from '../shared/contracts.js';
import { buildDecisionFromMemo } from './research/decisioning.js';
import { evaluateCandidateReport } from './research/cachePolicy.js';
import {
  createResearchRunId,
  describeError,
  logMetricEvent,
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
import { storeResearchRunTrace } from './db/researchRunTraceRepository.js';
import { buildResearchRunTracePayload } from './research/traceArtifacts.js';
import {
  buildBackgroundRefreshMetricPayload,
  buildResearchRunMetricPayload
} from './research/metrics.js';
import {
  createBackgroundRefreshPolicyState,
  getBackgroundRefreshDecision,
  markBackgroundRefreshCompleted,
  markBackgroundRefreshFailed,
  markBackgroundRefreshScheduled
} from './research/backgroundRefreshPolicy.js';
type ResearchProgressListener = (update: ResearchProgressUpdate) => void;
type ResearchActivityListener = (update: ResearchActivityUpdate) => void;
type ResearchWorkflowOptions = {
  onProgress?: ResearchProgressListener;
  onActivity?: ResearchActivityListener;
  forceRefresh?: boolean;
  skipAcceptedReportCache?: boolean;
  backgroundRefresh?: boolean;
  seededResolution?: Awaited<ReturnType<typeof resolveVendorIdentity>>;
};

const backgroundRefreshPolicyState = createBackgroundRefreshPolicyState();

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

function getBackgroundRefreshTimeoutCooldownMs() {
  const parsed = Number(process.env.BACKGROUND_REFRESH_TIMEOUT_COOLDOWN_MS ?? 3_600_000);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 3_600_000;
  }

  return parsed;
}

export async function researchCompany(
  companyName: string,
  options: {
    forceRefresh?: boolean;
    onProgress?: ResearchProgressListener;
    onActivity?: ResearchActivityListener;
  } = {}
) {
  return runResearchWorkflow(companyName, {
    forceRefresh: options.forceRefresh,
    onActivity: options.onActivity,
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
  const phaseTimings: Record<string, number> = {};
  const cachePath: Record<string, unknown> = {
    resolutionSource,
    acceptedReportCache: options.skipAcceptedReportCache ? 'skipped' : 'miss',
    backgroundRefresh: Boolean(options.backgroundRefresh),
    forceRefresh: Boolean(options.forceRefresh),
    streamed: Boolean(options.onProgress)
  };

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

      if (!options.seededResolution) {
        await tryStoreVendorResolution(runId, companyName, resolution);
      }
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
    phaseTimings.resolutionCompletedMs = Date.now() - startedAt;
    cachePath.resolutionSource = resolutionSource;
    options.onActivity?.({
      kind: 'resolution',
      label:
        companyName === resolution.canonicalName
          ? `Resolved review subject as ${resolution.canonicalName}`
          : `Resolved ${companyName} under ${resolution.canonicalName}`
    });

    const cachedReport = options.skipAcceptedReportCache
      ? null
      : await tryLoadAcceptedReportSnapshot(runId, companyName, acceptedSubjectKey);

    if (cachedReport) {
      options.onProgress?.(
        liveResearchStages.find((stage) => stage.stage === 'finalizing') ?? {
          stage: 'finalizing',
          label: 'Finalizing report'
        }
      );
      logResearchEvent('report_cache_hit', {
        runId,
        subjectName: companyName,
        canonicalName: resolution.canonicalName,
        bundleId: cachedReport.bundleId,
        cachedAt: cachedReport.fetchedAt
      });
      phaseTimings.cacheHitMs = Date.now() - startedAt;
      phaseTimings.completedMs = Date.now() - startedAt;
      cachePath.acceptedReportCache = 'hit';
      cachePath.bundleId = cachedReport.bundleId;
      maybeStartBackgroundRefresh(runId, companyName, acceptedSubjectKey, resolution, cachedReport);
      await tryStoreResearchRunTrace(runId, buildResearchRunTracePayload({
        runId,
        requestedSubjectName: companyName,
        subjectKey: acceptedSubjectKey,
        canonicalSubjectName: cachedReport.report.companyName,
        canonicalVendorName: resolution.canonicalName,
        officialDomains: resolution.officialDomains,
        outcome: 'succeeded',
        cachePath,
        phaseTimings,
        memoLength: cachedReport.memo.length,
        report: cachedReport.report,
        promotionResult: {
          promotedCandidate: false,
          reason: 'accepted_cache_hit',
          detail: cachedReport.bundleId
        },
        bundleId: cachedReport.bundleId,
        baselineBundleId: cachedReport.bundleId,
        backgroundRefresh: options.backgroundRefresh,
        forceRefresh: options.forceRefresh,
        streamed: Boolean(options.onProgress)
      }));
      logMetricEvent(
        'research_run_summary',
        buildResearchRunMetricPayload({
          runId,
          requestedSubjectName: companyName,
          subjectKey: acceptedSubjectKey,
          canonicalSubjectName: cachedReport.report.companyName,
          canonicalVendorName: resolution.canonicalName,
          outcome: 'succeeded',
          report: cachedReport.report,
          previousRecommendation: cachedReport.report.recommendation,
          phaseTimings,
          cachePath,
          backgroundRefresh: options.backgroundRefresh,
          forceRefresh: options.forceRefresh,
          streamed: Boolean(options.onProgress)
        })
      );

      return cachedReport.report;
    }

    cachePath.acceptedReportCache = options.skipAcceptedReportCache ? 'skipped' : 'miss';

    baselineSnapshot = await tryLoadLatestAcceptedReportSnapshot(
      runId,
      companyName,
      acceptedSubjectKey
    );
    cachePath.baselineBundleId = baselineSnapshot?.bundleId ?? null;

    phase = 'retrieval';
    memo = await generateResearchMemo(
      companyName,
      resolution,
      startedAt,
      budgetMs,
      options.onProgress,
      undefined,
      {
        onActivity: options.onActivity,
        backgroundRefresh: options.backgroundRefresh,
        onDiagnostic: (event) => {
          logResearchEvent('retrieval_diagnostic', {
            runId,
            subjectName: companyName,
            canonicalName: resolution?.canonicalName ?? null,
            backgroundRefresh: Boolean(options.backgroundRefresh),
            diagnosticEvent: event.event,
            attempt: event.attempt,
            elapsedMs: event.elapsedMs,
            detail: event.detail ?? null
          });
        }
      }
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
    phaseTimings.memoGeneratedMs = Date.now() - startedAt;

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
    phaseTimings.decisionBuiltMs = Date.now() - startedAt;

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
    cachePath.baselineBundleId = baselineSnapshot?.bundleId ?? null;
    cachePath.promotedCandidate = promotionDecision.promoteCandidate;
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
    phaseTimings.reportPresentedMs = Date.now() - startedAt;
    phaseTimings.completedMs = Date.now() - startedAt;
    cachePath.bundleId = storedArtifacts?.bundleId ?? null;
    cachePath.retainedBaselineBundleId =
      promotionDecision.promoteCandidate ? null : baselineSnapshot?.bundleId ?? null;
    await tryStoreResearchRunTrace(runId, buildResearchRunTracePayload({
      runId,
      requestedSubjectName: companyName,
      subjectKey: acceptedSubjectKey,
      canonicalSubjectName: report.companyName,
      canonicalVendorName: resolution.canonicalName,
      officialDomains: resolution.officialDomains,
      outcome: 'succeeded',
      cachePath,
      phaseTimings,
      memoLength: memo.length,
      report,
      promotionResult: {
        promotedCandidate: promotionDecision.promoteCandidate,
        reason: promotionDecision.reason,
        detail: promotionDecision.detail ?? null
      },
      bundleId: storedArtifacts?.bundleId ?? null,
      baselineBundleId: baselineSnapshot?.bundleId ?? null,
      backgroundRefresh: options.backgroundRefresh,
      forceRefresh: options.forceRefresh,
      streamed: Boolean(options.onProgress)
    }));
    logMetricEvent(
      'research_run_summary',
      buildResearchRunMetricPayload({
        runId,
        requestedSubjectName: companyName,
        subjectKey: acceptedSubjectKey,
        canonicalSubjectName: report.companyName,
        canonicalVendorName: resolution.canonicalName,
        outcome: 'succeeded',
        report,
        previousRecommendation: baselineSnapshot?.report.recommendation ?? null,
        phaseTimings,
        cachePath,
        backgroundRefresh: options.backgroundRefresh,
        forceRefresh: options.forceRefresh,
        streamed: Boolean(options.onProgress)
      })
    );

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
    phaseTimings.failedMs = Date.now() - startedAt;
    await tryStoreResearchRunTrace(runId, buildResearchRunTracePayload({
      runId,
      requestedSubjectName:
        phase === 'intake'
          ? rawCompanyName.trim() || inputSummary.preview
          : companyName,
      subjectKey: acceptedSubjectKey || null,
      canonicalSubjectName: decision?.companyName ?? null,
      canonicalVendorName: resolution?.canonicalName ?? null,
      officialDomains: resolution?.officialDomains ?? [],
      outcome: 'failed',
      cachePath,
      phaseTimings,
      memoLength: memo.length,
      report: null,
      promotionResult: null,
      bundleId: null,
      baselineBundleId: baselineSnapshot?.bundleId ?? null,
      error: {
        phase,
        ...describeError(error)
      },
      backgroundRefresh: options.backgroundRefresh,
      forceRefresh: options.forceRefresh,
      streamed: Boolean(options.onProgress)
    }));
    logMetricEvent(
      'research_run_summary',
      buildResearchRunMetricPayload({
        runId,
        requestedSubjectName:
          phase === 'intake'
            ? rawCompanyName.trim() || inputSummary.preview
            : companyName,
        subjectKey: acceptedSubjectKey || null,
        canonicalSubjectName: decision?.companyName ?? null,
        canonicalVendorName: resolution?.canonicalName ?? null,
        outcome: 'failed',
        previousRecommendation: baselineSnapshot?.report.recommendation ?? null,
        phaseTimings,
        cachePath,
        error: {
          phase,
          ...describeError(error)
        },
        backgroundRefresh: options.backgroundRefresh,
        forceRefresh: options.forceRefresh,
        streamed: Boolean(options.onProgress)
      })
    );
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
  const timeoutCooldownMs = getBackgroundRefreshTimeoutCooldownMs();
  const now = Date.now();
  const decision = getBackgroundRefreshDecision({
    state: backgroundRefreshPolicyState,
    subjectKey,
    now,
    cooldownMs
  });

  if (decision.skip) {
    logResearchEvent('background_refresh_skipped', {
      runId,
      subjectName: requestedSubjectName,
      canonicalName: resolution.canonicalName,
      subjectKey,
      reason: decision.reason,
      cooldownMs: decision.cooldownMs
    });
    logMetricEvent(
      'background_refresh_event',
      buildBackgroundRefreshMetricPayload({
        runId,
        subjectName: requestedSubjectName,
        subjectKey,
        canonicalName: resolution.canonicalName,
        state: 'skipped',
        reason: decision.reason,
        cooldownMs: decision.cooldownMs
      })
    );
    return;
  }

  markBackgroundRefreshScheduled(backgroundRefreshPolicyState, subjectKey, now);

  logResearchEvent('background_refresh_scheduled', {
    runId,
    subjectName: requestedSubjectName,
    canonicalName: resolution.canonicalName,
    subjectKey,
    bundleId: cachedReport?.bundleId,
    cachedAt: cachedReport?.fetchedAt
  });
  logMetricEvent(
    'background_refresh_event',
    buildBackgroundRefreshMetricPayload({
      runId,
      subjectName: requestedSubjectName,
      subjectKey,
      canonicalName: resolution.canonicalName,
      state: 'scheduled'
    })
  );

  setTimeout(() => {
    void runResearchWorkflow(requestedSubjectName, {
      skipAcceptedReportCache: true,
      backgroundRefresh: true,
      seededResolution: resolution
    })
      .then((report) => {
        markBackgroundRefreshCompleted(backgroundRefreshPolicyState, subjectKey);
        logResearchEvent('background_refresh_completed', {
          runId,
          subjectName: requestedSubjectName,
          canonicalName: report.companyName,
          subjectKey,
          recommendation: report.recommendation
        });
        logMetricEvent(
          'background_refresh_event',
          buildBackgroundRefreshMetricPayload({
            runId,
            subjectName: requestedSubjectName,
            subjectKey,
            canonicalName: report.companyName,
            state: 'completed'
          })
        );
      })
      .catch((error) => {
        const errorDetails = describeError(error);
        markBackgroundRefreshFailed(backgroundRefreshPolicyState, {
          subjectKey,
          now: Date.now(),
          errorClass: errorDetails.errorClass,
          timeoutCooldownMs
        });
        logResearchEvent('background_refresh_failed', {
          runId,
          subjectName: requestedSubjectName,
          canonicalName: resolution.canonicalName,
          subjectKey,
          ...errorDetails
        });
        logMetricEvent(
          'background_refresh_event',
          buildBackgroundRefreshMetricPayload({
            runId,
            subjectName: requestedSubjectName,
            subjectKey,
            canonicalName: resolution.canonicalName,
            state: 'failed',
            errorClass: errorDetails.errorClass
          })
        );
      })
      .finally(() => {
        if (!backgroundRefreshPolicyState.blockedUntil.has(subjectKey)) {
          markBackgroundRefreshCompleted(backgroundRefreshPolicyState, subjectKey);
        }
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

async function tryStoreResearchRunTrace(
  runId: string,
  trace: ReturnType<typeof buildResearchRunTracePayload>
) {
  try {
    await storeResearchRunTrace(trace);
  } catch (error) {
    logResearchEvent('cache_write_failed', {
      runId,
      cacheLayer: 'research_run_trace',
      ...describeError(error)
    });
  }
}

export {
  IncompleteResearchError,
  InvalidVendorInputError,
  MissingOpenAIKeyError,
  ResearchDecisionError,
  ResearchGenerationError,
  ResearchTimeoutError,
  VendorResolutionError
};
