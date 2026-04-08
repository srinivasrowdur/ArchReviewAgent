import 'dotenv/config';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { enterpriseReadinessReportSchema } from '../server/research/reportSchema.js';
import {
  listResearchRunTraces,
  loadResearchRunTrace,
  type StoredResearchRunTrace
} from '../server/db/researchRunTraceRepository.js';
import { closeDatabasePool } from '../server/db/client.js';
import { isDatabaseConfigured } from '../server/db/config.js';
import {
  gradeProductResolutionInput,
  type ProductResolutionGrade,
  type ProductResolutionGraderInput
} from './graders/productResolutionGrader.js';
import {
  gradeGuardrailQualityInput,
  type GuardrailQualityGrade,
  type GuardrailQualityGraderInput
} from './graders/guardrailQualityGrader.js';
import { getEvalModelSetting } from './modelConfig.js';

const shadowTraceSchema = z.object({
  runId: z.string().trim().min(1),
  requestedSubjectName: z.string().trim().min(1),
  subjectKey: z.string().trim().min(1).nullable(),
  canonicalSubjectName: z.string().trim().min(1).nullable(),
  canonicalVendorName: z.string().trim().min(1).nullable(),
  officialDomains: z.array(z.string().trim().min(1)).default([]),
  outcome: z.enum(['succeeded', 'failed']),
  recommendation: z.enum(['green', 'yellow', 'red']).nullable(),
  euStatus: z.enum(['supported', 'partial', 'unsupported', 'unknown']).nullable(),
  enterpriseStatus: z.enum(['supported', 'partial', 'unsupported', 'unknown']).nullable(),
  cachePath: z.record(z.string(), z.unknown()),
  phaseTimings: z.record(z.string(), z.number()),
  memoLength: z.number().int().nonnegative(),
  promotionResult: z.record(z.string(), z.unknown()).nullable(),
  bundleId: z.string().trim().min(1).nullable(),
  baselineBundleId: z.string().trim().min(1).nullable(),
  errorPhase: z.string().trim().min(1).nullable(),
  errorClass: z.string().trim().min(1).nullable(),
  errorName: z.string().trim().min(1).nullable(),
  errorMessage: z.string().trim().min(1).nullable(),
  trace: z.object({
    traceVersion: z.literal(1),
    context: z.object({
      backgroundRefresh: z.boolean(),
      forceRefresh: z.boolean(),
      streamed: z.boolean()
    }),
    report: enterpriseReadinessReportSchema.nullable()
  }).passthrough(),
  createdAt: z.string().trim().min(1)
});

type ShadowTrace = z.infer<typeof shadowTraceSchema>;

type ProductionShadowGradeResult = {
  runId: string;
  requestedSubjectName: string;
  canonicalSubjectName: string | null;
  canonicalVendorName: string | null;
  createdAt: string;
  recommendation: string | null;
  previousRecommendation: string | null;
  recommendationChanged: boolean;
  unknownGuardrails: string[];
  flags: string[];
  lowScore: boolean;
  productResolutionGrade: ProductResolutionGrade;
  guardrailQualityGrade: GuardrailQualityGrade;
  overallScore: number;
};

type ProductionShadowGradeFailure = {
  runId: string;
  requestedSubjectName: string;
  createdAt: string;
  outcome: 'failed';
  detail: string;
};

type ProductionShadowGradeOutput = {
  generatedAt: string;
  modelSetting: ReturnType<typeof getEvalModelSetting>;
  source: {
    kind: 'database' | 'file';
    detail: string;
  };
  totals: {
    traces: number;
    graded: number;
    failures: number;
    lowScore: number;
    unknownCases: number;
    recommendationChanges: number;
  };
  lowScoringRunIds: string[];
  unknownRunIds: string[];
  recommendationChangedRunIds: string[];
  gradedRuns: ProductionShadowGradeResult[];
  failedRuns: ProductionShadowGradeFailure[];
};

type ShadowRunnerDependencies = {
  gradeProductResolution?: (
    input: ProductResolutionGraderInput
  ) => Promise<ProductResolutionGrade>;
  gradeGuardrailQuality?: (
    input: GuardrailQualityGraderInput
  ) => Promise<GuardrailQualityGrade>;
};

const LOW_SCORE_THRESHOLD = 0.7;

export async function runProductionShadowGrading(
  traces: StoredResearchRunTrace[],
  dependencies: ShadowRunnerDependencies = {}
) {
  const gradeProductResolution =
    dependencies.gradeProductResolution ?? gradeProductResolutionInput;
  const gradeGuardrailQuality =
    dependencies.gradeGuardrailQuality ?? gradeGuardrailQualityInput;

  const sortedTraces = [...traces].sort((left, right) =>
    compareCreatedAtDesc(left.createdAt, right.createdAt)
  );
  const previousRecommendationByTrace = buildPreviousRecommendationMap(sortedTraces);
  const gradedRuns: ProductionShadowGradeResult[] = [];
  const failedRuns: ProductionShadowGradeFailure[] = [];

  for (const trace of sortedTraces) {
    if (!trace.trace.report) {
      failedRuns.push({
        runId: trace.runId,
        requestedSubjectName: trace.requestedSubjectName,
        createdAt: trace.createdAt,
        outcome: 'failed',
        detail: trace.errorMessage ?? 'Trace does not contain a report to grade.'
      });
      continue;
    }

    try {
      const [productResolutionGrade, guardrailQualityGrade] = await Promise.all([
        gradeProductResolution(buildProductResolutionInput(trace)),
        gradeGuardrailQuality(buildGuardrailQualityInput(trace))
      ]);
      const unknownGuardrails = collectUnknownGuardrails(trace);
      const previousRecommendation = previousRecommendationByTrace.get(trace.runId) ?? null;
      const recommendationChanged =
        Boolean(previousRecommendation) && previousRecommendation !== trace.recommendation;
      const flags = Array.from(
        new Set([...productResolutionGrade.flags, ...guardrailQualityGrade.flags])
      ).sort();
      const overallScore = Number(
        ((productResolutionGrade.score + guardrailQualityGrade.score) / 2).toFixed(3)
      );
      const lowScore =
        productResolutionGrade.score < LOW_SCORE_THRESHOLD ||
        guardrailQualityGrade.score < LOW_SCORE_THRESHOLD ||
        overallScore < LOW_SCORE_THRESHOLD;

      gradedRuns.push({
        runId: trace.runId,
        requestedSubjectName: trace.requestedSubjectName,
        canonicalSubjectName: trace.canonicalSubjectName,
        canonicalVendorName: trace.canonicalVendorName,
        createdAt: trace.createdAt,
        recommendation: trace.recommendation,
        previousRecommendation,
        recommendationChanged,
        unknownGuardrails,
        flags,
        lowScore,
        productResolutionGrade,
        guardrailQualityGrade,
        overallScore
      });
    } catch (error) {
      failedRuns.push({
        runId: trace.runId,
        requestedSubjectName: trace.requestedSubjectName,
        createdAt: trace.createdAt,
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const lowScoringRunIds = gradedRuns.filter((run) => run.lowScore).map((run) => run.runId);
  const unknownRunIds = gradedRuns
    .filter((run) => run.unknownGuardrails.length > 0)
    .map((run) => run.runId);
  const recommendationChangedRunIds = gradedRuns
    .filter((run) => run.recommendationChanged)
    .map((run) => run.runId);

  return {
    generatedAt: new Date().toISOString(),
    modelSetting: getEvalModelSetting(),
    source: {
      kind: 'database',
      detail: 'stored research_run_traces'
    },
    totals: {
      traces: sortedTraces.length,
      graded: gradedRuns.length,
      failures: failedRuns.length,
      lowScore: lowScoringRunIds.length,
      unknownCases: unknownRunIds.length,
      recommendationChanges: recommendationChangedRunIds.length
    },
    lowScoringRunIds,
    unknownRunIds,
    recommendationChangedRunIds,
    gradedRuns,
    failedRuns
  } satisfies ProductionShadowGradeOutput;
}

export async function loadShadowTracesFromFile(inputPath: string) {
  const absolutePath = path.resolve(inputPath);
  const content = await readFile(absolutePath, 'utf8');
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return shadowTraceSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid shadow trace in ${absolutePath}:${index + 1}: ${String(error)}`);
    }
  });
}

export async function loadShadowTracesFromDatabase(options: {
  subjectName?: string;
  limit?: number;
  runIds?: string[];
}) {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL must be set to load production traces from the database.');
  }

  if (options.runIds && options.runIds.length > 0) {
    const traces = await Promise.all(options.runIds.map((runId) => loadResearchRunTrace(runId)));
    return traces.filter((trace): trace is StoredResearchRunTrace => Boolean(trace));
  }

  return listResearchRunTraces({
    subjectName: options.subjectName,
    limit: options.limit
  });
}

export async function writeProductionShadowReports(
  summary: ProductionShadowGradeOutput,
  outputRoot = 'evals/reports'
) {
  const timestamp = summary.generatedAt.replace(/[:.]/g, '-');
  const outputDir = path.resolve(outputRoot, `production-shadow-grading-${timestamp}`);
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'summary.json');
  const markdownPath = path.join(outputDir, 'summary.md');

  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderMarkdownSummary(summary)}\n`, 'utf8');

  return {
    outputDir,
    jsonPath,
    markdownPath
  };
}

function buildProductResolutionInput(trace: StoredResearchRunTrace): ProductResolutionGraderInput {
  if (!trace.trace.report) {
    throw new Error('Trace report is required for product resolution grading.');
  }

  return {
    requestedSubject: trace.requestedSubjectName,
    resolvedVendor: {
      canonicalName: trace.canonicalVendorName ?? trace.canonicalSubjectName ?? trace.requestedSubjectName,
      officialDomains: trace.officialDomains.length > 0 ? trace.officialDomains : ['unknown.local']
    },
    report: trace.trace.report
  };
}

function buildGuardrailQualityInput(trace: StoredResearchRunTrace): GuardrailQualityGraderInput {
  if (!trace.trace.report) {
    throw new Error('Trace report is required for guardrail quality grading.');
  }

  return {
    requestedSubject: trace.requestedSubjectName,
    report: trace.trace.report
  };
}

function collectUnknownGuardrails(trace: StoredResearchRunTrace) {
  const unknowns: string[] = [];

  if (trace.euStatus === 'unknown') {
    unknowns.push('euDataResidency');
  }

  if (trace.enterpriseStatus === 'unknown') {
    unknowns.push('enterpriseDeployment');
  }

  return unknowns;
}

function buildPreviousRecommendationMap(traces: StoredResearchRunTrace[]) {
  const previousRecommendationByTrace = new Map<string, string | null>();
  const previousBySubject = new Map<string, string | null>();

  for (const trace of [...traces].sort((left, right) => compareCreatedAtAsc(left.createdAt, right.createdAt))) {
    const subjectIdentity = trace.subjectKey ?? trace.requestedSubjectName.trim().toLowerCase();
    previousRecommendationByTrace.set(trace.runId, previousBySubject.get(subjectIdentity) ?? null);

    if (trace.outcome === 'succeeded' && trace.recommendation) {
      previousBySubject.set(subjectIdentity, trace.recommendation);
    }
  }

  return previousRecommendationByTrace;
}

function compareCreatedAtDesc(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function compareCreatedAtAsc(left: string, right: string) {
  return Date.parse(left) - Date.parse(right);
}

function renderMarkdownSummary(summary: ProductionShadowGradeOutput) {
  const lines: string[] = [
    '# Production Shadow Grading Summary',
    '',
    `Generated at: ${summary.generatedAt}`,
    `Model setting: ${summary.modelSetting.value}`,
    `Source: ${summary.source.kind} (${summary.source.detail})`,
    '',
    '## Totals',
    '',
    `- Traces: ${summary.totals.traces}`,
    `- Graded: ${summary.totals.graded}`,
    `- Failures: ${summary.totals.failures}`,
    `- Low-score runs: ${summary.totals.lowScore}`,
    `- Unknown runs: ${summary.totals.unknownCases}`,
    `- Recommendation changes: ${summary.totals.recommendationChanges}`,
    ''
  ];

  if (summary.lowScoringRunIds.length > 0) {
    lines.push('## Low-Scoring Runs', '');
    for (const run of summary.gradedRuns.filter((entry) => entry.lowScore)) {
      lines.push(
        `- \`${run.runId}\` ${run.requestedSubjectName}: overall ${run.overallScore.toFixed(2)}; product=${run.productResolutionGrade.score.toFixed(2)}; guardrails=${run.guardrailQualityGrade.score.toFixed(2)}`
      );
    }
    lines.push('');
  }

  if (summary.unknownRunIds.length > 0) {
    lines.push('## Unknown Cases', '');
    for (const run of summary.gradedRuns.filter((entry) => entry.unknownGuardrails.length > 0)) {
      lines.push(
        `- \`${run.runId}\` ${run.requestedSubjectName}: ${run.unknownGuardrails.join(', ')}`
      );
    }
    lines.push('');
  }

  if (summary.recommendationChangedRunIds.length > 0) {
    lines.push('## Recommendation Changes', '');
    for (const run of summary.gradedRuns.filter((entry) => entry.recommendationChanged)) {
      lines.push(
        `- \`${run.runId}\` ${run.requestedSubjectName}: ${run.previousRecommendation} -> ${run.recommendation}`
      );
    }
    lines.push('');
  }

  if (summary.failedRuns.length > 0) {
    lines.push('## Failed Runs', '');
    for (const run of summary.failedRuns) {
      lines.push(`- \`${run.runId}\` ${run.requestedSubjectName}: ${run.detail}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readFlags(args: string[], flag: string) {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }

  return values;
}

async function main() {
  const args = process.argv.slice(2);
  const inputFile = readFlag(args, '--input-file');
  const subjectName = readFlag(args, '--subject');
  const limitValue = readFlag(args, '--limit');
  const outputRoot = readFlag(args, '--output-dir') ?? 'evals/reports';
  const runIds = readFlags(args, '--run-id');
  const limit = limitValue ? Number(limitValue) : 10;

  const traces = inputFile
    ? await loadShadowTracesFromFile(inputFile)
    : await loadShadowTracesFromDatabase({
        subjectName,
        limit,
        runIds
      });

  const summary = await runProductionShadowGrading(traces);
  summary.source = inputFile
    ? {
        kind: 'file',
        detail: path.resolve(inputFile)
      }
    : summary.source;

  const outputPaths = await writeProductionShadowReports(summary, outputRoot);

  process.stdout.write(
    `${JSON.stringify(
      {
        ...summary,
        outputPaths
      },
      null,
      2
    )}\n`
  );

  if (summary.totals.failures > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabasePool();
    });
}
