import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { MissingOpenAIKeyError } from '../server/research/errors.js';
import { getEvalModelSetting } from './modelConfig.js';
import {
  gradeGuardrailQualityCase,
  type GuardrailQualityGrade
} from './graders/guardrailQualityGrader.js';
import {
  guardrailQualityCaseSchema,
  type GuardrailQualityCase
} from './graders/guardrailQualityCaseSchema.js';

type GraderEvalResult = {
  caseId: string;
  category: GuardrailQualityCase['category'];
  outcome: 'passed' | 'failed';
  detail: string;
  durationMs: number;
  grade?: GuardrailQualityGrade;
};

type GraderEvalSummary = {
  generatedAt: string;
  modelSetting: ReturnType<typeof getEvalModelSetting>;
  totals: {
    cases: number;
    passed: number;
    failed: number;
  };
  results: GraderEvalResult[];
};

export async function runGuardrailQualityGrader(
  cases: GuardrailQualityCase[],
  gradeCase: (testCase: GuardrailQualityCase) => Promise<GuardrailQualityGrade> = (
    testCase
  ) => gradeGuardrailQualityCase(testCase)
) {
  const results: GraderEvalResult[] = [];

  for (const testCase of cases) {
    const startedAt = Date.now();

    try {
      const grade = await gradeCase(testCase);
      const mismatches = collectExpectationMismatches(testCase, grade);

      results.push({
        caseId: testCase.id,
        category: testCase.category,
        outcome: mismatches.length === 0 ? 'passed' : 'failed',
        detail:
          mismatches.length === 0
            ? 'Grader output matched expectations.'
            : mismatches.join(' '),
        durationMs: Date.now() - startedAt,
        grade
      });
    } catch (error) {
      results.push({
        caseId: testCase.id,
        category: testCase.category,
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    modelSetting: getEvalModelSetting(),
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.outcome === 'passed').length,
      failed: results.filter((result) => result.outcome === 'failed').length
    },
    results
  } satisfies GraderEvalSummary;
}

export async function loadGuardrailQualityCases(inputPaths: string[]) {
  const discoveredCases: GuardrailQualityCase[] = [];

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    const content = await readFile(absolutePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const [index, line] of lines.entries()) {
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON in ${absolutePath}:${index + 1}: ${String(error)}`
        );
      }

      discoveredCases.push(guardrailQualityCaseSchema.parse(parsedJson));
    }
  }

  return discoveredCases;
}

function collectExpectationMismatches(
  testCase: GuardrailQualityCase,
  grade: GuardrailQualityGrade
) {
  const mismatches: string[] = [];

  if (grade.pass !== testCase.expected.pass) {
    mismatches.push(`expected pass=${testCase.expected.pass}, got ${grade.pass}.`);
  }

  if (
    testCase.expected.minimumScore !== undefined &&
    grade.score < testCase.expected.minimumScore
  ) {
    mismatches.push(
      `expected score >= ${testCase.expected.minimumScore}, got ${grade.score}.`
    );
  }

  if (
    testCase.expected.maximumScore !== undefined &&
    grade.score > testCase.expected.maximumScore
  ) {
    mismatches.push(
      `expected score <= ${testCase.expected.maximumScore}, got ${grade.score}.`
    );
  }

  for (const requiredFlag of testCase.expected.requiredFlags) {
    if (!grade.flags.includes(requiredFlag)) {
      mismatches.push(`missing required flag ${requiredFlag}.`);
    }
  }

  for (const forbiddenFlag of testCase.expected.forbiddenFlags) {
    if (grade.flags.includes(forbiddenFlag)) {
      mismatches.push(`unexpected flag ${forbiddenFlag}.`);
    }
  }

  if (testCase.expected.pass) {
    const allowedFlags = new Set(testCase.expected.requiredFlags);

    for (const actualFlag of grade.flags) {
      if (!allowedFlags.has(actualFlag)) {
        mismatches.push(`unexpected extra flag ${actualFlag}.`);
      }
    }
  }

  if (
    !matchesExpectedValue(
      testCase.expected.expectedEuResidencySupport,
      grade.euResidencyVerdictSupport
    )
  ) {
    mismatches.push(
      `expected euResidencyVerdictSupport=${formatExpectedValue(testCase.expected.expectedEuResidencySupport)}, got ${grade.euResidencyVerdictSupport}.`
    );
  }

  if (
    !matchesExpectedValue(
      testCase.expected.expectedEnterpriseDeploymentSupport,
      grade.enterpriseDeploymentVerdictSupport
    )
  ) {
    mismatches.push(
      `expected enterpriseDeploymentVerdictSupport=${formatExpectedValue(testCase.expected.expectedEnterpriseDeploymentSupport)}, got ${grade.enterpriseDeploymentVerdictSupport}.`
    );
  }

  if (
    !matchesExpectedValue(
      testCase.expected.expectedRecommendationQuality,
      grade.recommendationQuality
    )
  ) {
    mismatches.push(
      `expected recommendationQuality=${formatExpectedValue(testCase.expected.expectedRecommendationQuality)}, got ${grade.recommendationQuality}.`
    );
  }

  if (
    !matchesExpectedValue(
      testCase.expected.expectedCitationRelevance,
      grade.citationRelevance
    )
  ) {
    mismatches.push(
      `expected citationRelevance=${formatExpectedValue(testCase.expected.expectedCitationRelevance)}, got ${grade.citationRelevance}.`
    );
  }

  return mismatches;
}

function matchesExpectedValue(
  expected: string | string[],
  actual: string
) {
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function formatExpectedValue(expected: string | string[]) {
  return Array.isArray(expected) ? expected.join('|') : expected;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new MissingOpenAIKeyError();
  }

  const inputPaths = process.argv.slice(2);
  const casePaths =
    inputPaths.length > 0
      ? inputPaths
      : ['evals/cases/guardrail-quality-grader.jsonl'];
  const cases = await loadGuardrailQualityCases(casePaths);
  const summary = await runGuardrailQualityGrader(cases);

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const summary: GraderEvalSummary = {
      generatedAt: new Date().toISOString(),
      modelSetting: getEvalModelSetting(),
      totals: {
        cases: 0,
        passed: 0,
        failed: 1
      },
      results: [
        {
          caseId: '<runner>',
          category: 'mixed-quality',
          outcome: 'failed',
          detail: error instanceof Error ? error.message : String(error),
          durationMs: 0
        }
      ]
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
  });
}
