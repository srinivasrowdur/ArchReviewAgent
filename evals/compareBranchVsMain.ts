import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getEvalModelSetting } from './modelConfig.js';

const execFileAsync = promisify(execFile);

const defaultSuites = [
  {
    id: 'deterministic-release',
    command: ['node', '--import', 'tsx', 'evals/runDeterministicReleaseEvals.ts']
  },
  {
    id: 'cache-source',
    command: ['node', '--import', 'tsx', 'evals/runCacheSourceEvals.ts']
  },
  {
    id: 'public-surface',
    command: ['node', '--import', 'tsx', 'evals/runPublicSurfaceEvals.ts']
  }
] as const;

type EvalOutcome = 'passed' | 'failed' | 'skipped';

type ReleaseSnapshot = {
  recommendation: 'green' | 'yellow' | 'red';
  guardrails: {
    euDataResidency: {
      status: 'supported' | 'partial' | 'unsupported' | 'unknown';
    };
    enterpriseDeployment: {
      status: 'supported' | 'partial' | 'unsupported' | 'unknown';
    };
  };
};

type GenericEvalResult = {
  caseId: string;
  category: string;
  outcome: EvalOutcome;
  detail: string;
  durationMs?: number;
  snapshot?: ReleaseSnapshot;
};

type GenericEvalSummary = {
  totals: Record<string, number>;
  results: GenericEvalResult[];
};

type SuiteExecution = {
  suiteId: string;
  cwd: string;
  durationMs: number;
  summary: GenericEvalSummary;
};

type ComparisonDelta = {
  suiteId: string;
  caseId: string;
  category: string;
};

type FailureDelta = ComparisonDelta & {
  baselineOutcome: EvalOutcome | 'missing';
  candidateOutcome: EvalOutcome | 'missing';
  detail: string;
};

type RecommendationDelta = ComparisonDelta & {
  baselineRecommendation: ReleaseSnapshot['recommendation'];
  candidateRecommendation: ReleaseSnapshot['recommendation'];
};

type UnknownDelta = ComparisonDelta & {
  guardrail: 'euDataResidency' | 'enterpriseDeployment';
  baselineStatus: ReleaseSnapshot['guardrails']['euDataResidency']['status'];
  candidateStatus: ReleaseSnapshot['guardrails']['euDataResidency']['status'];
};

type LatencyDelta = ComparisonDelta & {
  baselineDurationMs: number;
  candidateDurationMs: number;
  deltaMs: number;
};

type ComparisonReport = {
  generatedAt: string;
  modelSetting: {
    value: string;
    source: 'EVAL_MODEL' | 'OPENAI_MODEL' | 'unset';
  };
  baseline: {
    label: string;
    cwd: string;
    suites: SuiteExecution[];
  };
  candidate: {
    label: string;
    cwd: string;
    suites: SuiteExecution[];
  };
  regressions: {
    newFailures: FailureDelta[];
    changedRecommendations: RecommendationDelta[];
    newUnknownOutputs: UnknownDelta[];
    latencyDeltas: LatencyDelta[];
  };
  improvements: {
    resolvedFailures: FailureDelta[];
  };
};

type CompareOptions = {
  baselineDir?: string;
  baselineRef?: string;
  candidateDir?: string;
  outputDir?: string;
};

export function compareSuiteExecutions(
  baselineSuites: SuiteExecution[],
  candidateSuites: SuiteExecution[]
): ComparisonReport['regressions'] & ComparisonReport['improvements'] {
  const baselineResults = indexSuiteResults(baselineSuites);
  const candidateResults = indexSuiteResults(candidateSuites);
  const keys = new Set([...baselineResults.keys(), ...candidateResults.keys()]);
  const newFailures: FailureDelta[] = [];
  const resolvedFailures: FailureDelta[] = [];
  const changedRecommendations: RecommendationDelta[] = [];
  const newUnknownOutputs: UnknownDelta[] = [];
  const latencyDeltas: LatencyDelta[] = [];

  for (const key of keys) {
    const baselineEntry = baselineResults.get(key);
    const candidateEntry = candidateResults.get(key);

    if (!baselineEntry && candidateEntry) {
      if (candidateEntry.result.outcome === 'failed') {
        newFailures.push({
          suiteId: candidateEntry.suiteId,
          caseId: candidateEntry.result.caseId,
          category: candidateEntry.result.category,
          baselineOutcome: 'missing',
          candidateOutcome: candidateEntry.result.outcome,
          detail: candidateEntry.result.detail
        });
      }

      continue;
    }

    if (baselineEntry && !candidateEntry) {
      if (baselineEntry.result.outcome === 'failed') {
        resolvedFailures.push({
          suiteId: baselineEntry.suiteId,
          caseId: baselineEntry.result.caseId,
          category: baselineEntry.result.category,
          baselineOutcome: baselineEntry.result.outcome,
          candidateOutcome: 'missing',
          detail: baselineEntry.result.detail
        });
      }

      continue;
    }

    if (
      candidateEntry.result.outcome === 'failed' &&
      baselineEntry.result.outcome !== 'failed'
    ) {
      newFailures.push({
        suiteId: candidateEntry.suiteId,
        caseId: candidateEntry.result.caseId,
        category: candidateEntry.result.category,
        baselineOutcome: baselineEntry.result.outcome,
        candidateOutcome: candidateEntry.result.outcome,
        detail: candidateEntry.result.detail
      });
    }

    if (
      baselineEntry.result.outcome === 'failed' &&
      candidateEntry.result.outcome !== 'failed'
    ) {
      resolvedFailures.push({
        suiteId: candidateEntry.suiteId,
        caseId: candidateEntry.result.caseId,
        category: candidateEntry.result.category,
        baselineOutcome: baselineEntry.result.outcome,
        candidateOutcome: candidateEntry.result.outcome,
        detail: baselineEntry.result.detail
      });
    }

    if (
      baselineEntry.result.snapshot &&
      candidateEntry.result.snapshot &&
      baselineEntry.result.snapshot.recommendation !==
        candidateEntry.result.snapshot.recommendation
    ) {
      changedRecommendations.push({
        suiteId: candidateEntry.suiteId,
        caseId: candidateEntry.result.caseId,
        category: candidateEntry.result.category,
        baselineRecommendation: baselineEntry.result.snapshot.recommendation,
        candidateRecommendation: candidateEntry.result.snapshot.recommendation
      });
    }

    for (const guardrail of ['euDataResidency', 'enterpriseDeployment'] as const) {
      const baselineStatus = baselineEntry.result.snapshot?.guardrails[guardrail].status;
      const candidateStatus = candidateEntry.result.snapshot?.guardrails[guardrail].status;

      if (
        baselineStatus &&
        candidateStatus === 'unknown' &&
        baselineStatus !== 'unknown'
      ) {
        newUnknownOutputs.push({
          suiteId: candidateEntry.suiteId,
          caseId: candidateEntry.result.caseId,
          category: candidateEntry.result.category,
          guardrail,
          baselineStatus,
          candidateStatus
        });
      }
    }

    const baselineDurationMs = baselineEntry.result.durationMs ?? 0;
    const candidateDurationMs = candidateEntry.result.durationMs ?? 0;
    const deltaMs = candidateDurationMs - baselineDurationMs;

    if (isSignificantLatencyDelta(baselineDurationMs, candidateDurationMs)) {
      latencyDeltas.push({
        suiteId: candidateEntry.suiteId,
        caseId: candidateEntry.result.caseId,
        category: candidateEntry.result.category,
        baselineDurationMs,
        candidateDurationMs,
        deltaMs
      });
    }
  }

  latencyDeltas.sort((left, right) => Math.abs(right.deltaMs) - Math.abs(left.deltaMs));

  return {
    newFailures,
    changedRecommendations,
    newUnknownOutputs,
    latencyDeltas,
    resolvedFailures
  };
}

export function renderComparisonMarkdown(report: ComparisonReport) {
  const lines: string[] = [];

  lines.push('# Branch vs Main Release Comparison');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Model setting: \`${report.modelSetting.value}\` (${report.modelSetting.source})`);
  lines.push(`Baseline: \`${report.baseline.label}\` at \`${report.baseline.cwd}\``);
  lines.push(`Candidate: \`${report.candidate.label}\` at \`${report.candidate.cwd}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- New failures: ${report.regressions.newFailures.length}`);
  lines.push(`- Resolved failures: ${report.improvements.resolvedFailures.length}`);
  lines.push(`- Changed recommendations: ${report.regressions.changedRecommendations.length}`);
  lines.push(`- New unknown outputs: ${report.regressions.newUnknownOutputs.length}`);
  lines.push(`- Significant latency deltas: ${report.regressions.latencyDeltas.length}`);
  lines.push('');

  appendSection(
    lines,
    'New Failures',
    report.regressions.newFailures.map(
      (item) =>
        `- \`${item.suiteId}:${item.caseId}\` (${item.category}) baseline=${item.baselineOutcome} candidate=${item.candidateOutcome}: ${item.detail}`
    ),
    'None.'
  );

  appendSection(
    lines,
    'Resolved Failures',
    report.improvements.resolvedFailures.map(
      (item) =>
        `- \`${item.suiteId}:${item.caseId}\` (${item.category}) baseline=${item.baselineOutcome} candidate=${item.candidateOutcome}: ${item.detail}`
    ),
    'None.'
  );

  appendSection(
    lines,
    'Changed Recommendations',
    report.regressions.changedRecommendations.map(
      (item) =>
        `- \`${item.suiteId}:${item.caseId}\` changed from \`${item.baselineRecommendation}\` to \`${item.candidateRecommendation}\``
    ),
    'None.'
  );

  appendSection(
    lines,
    'New Unknown Outputs',
    report.regressions.newUnknownOutputs.map(
      (item) =>
        `- \`${item.suiteId}:${item.caseId}\` guardrail \`${item.guardrail}\` changed from \`${item.baselineStatus}\` to \`${item.candidateStatus}\``
    ),
    'None.'
  );

  appendSection(
    lines,
    'Significant Latency Deltas',
    report.regressions.latencyDeltas.map(
      (item) =>
        `- \`${item.suiteId}:${item.caseId}\` ${formatSignedMs(item.deltaMs)} (baseline ${item.baselineDurationMs}ms -> candidate ${item.candidateDurationMs}ms)`
    ),
    'None.'
  );

  return `${lines.join('\n')}\n`;
}

export async function generateBranchVsMainComparison(
  {
    baselineDir,
    baselineRef = 'origin/main',
    candidateDir = process.cwd(),
    outputDir
  }: CompareOptions = {}
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const normalizedCandidateDir = path.resolve(candidateDir);
  const reportsDir =
    outputDir ?? path.join(normalizedCandidateDir, 'evals', 'reports', timestamp);
  await mkdir(reportsDir, { recursive: true });

  const modelSetting = getEvalModelSetting();
  const baselineWorkspace =
    baselineDir ? await useExistingWorkspace(baselineDir) : await createBaselineWorktree(baselineRef);

  try {
    const [baselineSuites, candidateSuites] = await Promise.all([
      runAllSuites(path.resolve(baselineWorkspace.cwd), modelSetting.value),
      runAllSuites(normalizedCandidateDir, modelSetting.value)
    ]);

    const diff = compareSuiteExecutions(baselineSuites, candidateSuites);
    const report: ComparisonReport = {
      generatedAt: new Date().toISOString(),
      modelSetting,
      baseline: {
        label: baselineDir ? 'baseline-dir' : baselineRef,
        cwd: path.resolve(baselineWorkspace.cwd),
        suites: baselineSuites
      },
      candidate: {
        label: 'candidate',
        cwd: normalizedCandidateDir,
        suites: candidateSuites
      },
      regressions: {
        newFailures: diff.newFailures,
        changedRecommendations: diff.changedRecommendations,
        newUnknownOutputs: diff.newUnknownOutputs,
        latencyDeltas: diff.latencyDeltas
      },
      improvements: {
        resolvedFailures: diff.resolvedFailures
      }
    };

    const jsonPath = path.join(reportsDir, 'branch-vs-main.json');
    const markdownPath = path.join(reportsDir, 'branch-vs-main.md');
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(markdownPath, renderComparisonMarkdown(report));

    return {
      report,
      jsonPath,
      markdownPath
    };
  } finally {
    await baselineWorkspace.cleanup();
  }
}

async function runAllSuites(cwd: string, modelSetting: string) {
  const suites: SuiteExecution[] = [];

  for (const suite of defaultSuites) {
    suites.push(await runSuite(cwd, suite.id, suite.command, modelSetting));
  }

  return suites;
}

async function runSuite(
  cwd: string,
  suiteId: string,
  command: readonly string[],
  modelSetting: string
): Promise<SuiteExecution> {
  const startedAt = Date.now();

  try {
    const result = await execFileAsync(command[0], [...command.slice(1)], {
      cwd,
      env: {
        ...process.env,
        EVAL_MODEL: modelSetting
      }
    });

    return {
      suiteId,
      cwd,
      durationMs: Date.now() - startedAt,
      summary: JSON.parse(result.stdout) as GenericEvalSummary
    };
  } catch (error) {
    const stdout =
      error instanceof Error && 'stdout' in error
        ? String((error as { stdout?: unknown }).stdout ?? '')
        : '';

    if (!stdout.trim()) {
      throw error;
    }

    return {
      suiteId,
      cwd,
      durationMs: Date.now() - startedAt,
      summary: JSON.parse(stdout) as GenericEvalSummary
    };
  }
}

function indexSuiteResults(suites: SuiteExecution[]) {
  const entries = new Map<
    string,
    {
      suiteId: string;
      result: GenericEvalResult;
    }
  >();

  for (const suite of suites) {
    for (const result of suite.summary.results) {
      entries.set(`${suite.suiteId}:${result.caseId}`, {
        suiteId: suite.suiteId,
        result
      });
    }
  }

  return entries;
}

function isSignificantLatencyDelta(
  baselineDurationMs: number,
  candidateDurationMs: number
) {
  const deltaMs = Math.abs(candidateDurationMs - baselineDurationMs);
  const longerDuration = Math.max(baselineDurationMs, candidateDurationMs, 1);

  return deltaMs >= 50 && deltaMs / longerDuration >= 0.2;
}

function appendSection(
  lines: string[],
  title: string,
  entries: string[],
  emptyState: string
) {
  lines.push(`## ${title}`);
  lines.push('');

  if (entries.length === 0) {
    lines.push(emptyState);
  } else {
    lines.push(...entries);
  }

  lines.push('');
}

function formatSignedMs(value: number) {
  return `${value >= 0 ? '+' : ''}${value}ms`;
}

async function createBaselineWorktree(baselineRef: string) {
  const worktreeDir = await mkdtemp(
    path.join(os.tmpdir(), 'archagent-branch-comparison-')
  );

  await execFileAsync('git', ['worktree', 'add', '--detach', worktreeDir, baselineRef], {
    cwd: process.cwd()
  });

  return {
    cwd: worktreeDir,
    cleanup: async () => {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], {
        cwd: process.cwd()
      });
    }
  };
}

async function useExistingWorkspace(cwd: string) {
  return {
    cwd,
    cleanup: async () => {}
  };
}

function parseArgs(args: string[]) {
  const options: CompareOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];

    switch (current) {
      case '--baseline-dir':
        options.baselineDir = next;
        index += 1;
        break;
      case '--baseline-ref':
        options.baselineRef = next;
        index += 1;
        break;
      case '--candidate-dir':
        options.candidateDir = next;
        index += 1;
        break;
      case '--output-dir':
        options.outputDir = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return options;
}

async function main() {
  const { report, jsonPath, markdownPath } = await generateBranchVsMainComparison(
    parseArgs(process.argv.slice(2))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        jsonPath,
        markdownPath,
        regressions: report.regressions,
        improvements: report.improvements
      },
      null,
      2
    )}\n`
  );

  if (
    report.regressions.newFailures.length > 0 ||
    report.regressions.changedRecommendations.length > 0 ||
    report.regressions.newUnknownOutputs.length > 0
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
