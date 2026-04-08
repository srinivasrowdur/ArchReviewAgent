import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { EvalCase } from './caseSchema.js';
import { evalCaseSchema } from './caseSchema.js';
import { createMockReport } from '../server/mockReport.js';
import { enterpriseReadinessReportSchema } from '../server/research/reportSchema.js';
import {
  InvalidVendorInputError,
  VendorResolutionError
} from '../server/research/errors.js';
import {
  buildAmbiguousVendorResolutionMessage,
  validateVendorInput
} from '../server/research/vendorIntake.js';
import { formatResearchError } from '../server/formatResearchError.js';

type EvalResult =
  | {
      caseId: string;
      category: string;
      outcome: 'passed';
      detail: string;
      durationMs: number;
      snapshot?: SuccessSnapshot;
    }
  | {
      caseId: string;
      category: string;
      outcome: 'failed';
      detail: string;
      durationMs: number;
      snapshot?: SuccessSnapshot;
    }
  | {
      caseId: string;
      category: string;
      outcome: 'skipped';
      detail: string;
      durationMs: number;
      snapshot?: SuccessSnapshot;
    };

type EvalSummary = {
  totals: {
    cases: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: EvalResult[];
};

type SuccessSnapshot = {
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

async function main() {
  const inputPaths = process.argv.slice(2);
  const casePaths =
    inputPaths.length > 0 ? inputPaths : ['evals/cases/release-deterministic.jsonl'];
  const cases = await loadEvalCases(casePaths);
  const results = cases.map(runCase);
  const summary = buildSummary(results);

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

async function loadEvalCases(inputPaths: string[]) {
  const discoveredCases: EvalCase[] = [];

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

      discoveredCases.push(evalCaseSchema.parse(parsedJson));
    }
  }

  return discoveredCases;
}

function runCase(evalCase: EvalCase): EvalResult {
  const startedAt = Date.now();

  if (evalCase.expected_outcome === 'success') {
    try {
      const report = createMockReport(evalCase.input);
      enterpriseReadinessReportSchema.parse(report);
      const reportDomains = getReportDomains(report);
      const expectedDomains = new Set(
        evalCase.expected_official_domains.map((item) => item.trim().toLowerCase())
      );

      assertEqual(
        report.companyName,
        evalCase.expected_subject,
        'companyName did not match expected_subject'
      );
      assertEqual(
        report.companyName,
        evalCase.expected_vendor,
        'companyName did not match expected_vendor'
      );
      assertEqual(
        report.recommendation,
        evalCase.expected_recommendation,
        'recommendation did not match expected_recommendation'
      );
      assertEqual(
        report.guardrails.euDataResidency.status,
        evalCase.expected_guardrails.euDataResidency.status,
        'EU residency status did not match expected_guardrails'
      );
      assertEqual(
        report.guardrails.enterpriseDeployment.status,
        evalCase.expected_guardrails.enterpriseDeployment.status,
        'Enterprise deployment status did not match expected_guardrails'
      );

      if (!setEquals(reportDomains, expectedDomains)) {
        throw new Error(
          `report domains ${JSON.stringify([...reportDomains])} did not match expected_official_domains ${JSON.stringify([...expectedDomains])}`
        );
      }

      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'passed',
        detail: 'Deterministic success assertions passed.',
        durationMs: Date.now() - startedAt,
        snapshot: buildSuccessSnapshot(report)
      };
    } catch (error) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail: describeError(
          error,
          'Deterministic success assertions did not pass.'
        ),
        durationMs: Date.now() - startedAt
      };
    }
  }

  const rejectionCheck = evaluateRejectedCase(evalCase, startedAt);

  return rejectionCheck;
}

function evaluateRejectedCase(
  evalCase: Extract<EvalCase, { expected_outcome: 'rejection' }>,
  startedAt: number
): EvalResult {
  try {
    let formattedError: ReturnType<typeof formatResearchError> | null = null;

    if (evalCase.expected_error.status === 400) {
      try {
        validateVendorInput(evalCase.input);
      } catch (error) {
        if (error instanceof InvalidVendorInputError) {
          formattedError = formatResearchError(error);
        } else {
          throw error;
        }
      }
    } else if (evalCase.expected_error.status === 422) {
      const ambiguousError = new VendorResolutionError(
        buildAmbiguousVendorResolutionMessage([])
      );
      formattedError = formatResearchError(ambiguousError);
    }

    if (!formattedError) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail:
          `Expected a ${evalCase.expected_error.status} rejection containing "${evalCase.expected_error.message_includes}", but no error was produced.`,
        durationMs: Date.now() - startedAt
      };
    }

    if (formattedError.status !== evalCase.expected_error.status) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail:
          `Expected rejection status ${evalCase.expected_error.status}, got ${formattedError.status}.`,
        durationMs: Date.now() - startedAt
      };
    }

    return {
      caseId: evalCase.id,
      category: evalCase.category,
      outcome:
        formattedError.message.includes(evalCase.expected_error.message_includes)
          ? 'passed'
          : 'failed',
      detail: formattedError.message.includes(evalCase.expected_error.message_includes)
        ? 'Deterministic rejection assertions passed.'
        : `Expected rejection message containing "${evalCase.expected_error.message_includes}", got "${formattedError.message}".`,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      category: evalCase.category,
      outcome: 'failed',
      detail: describeError(error, 'Deterministic rejection assertions did not pass.'),
      durationMs: Date.now() - startedAt
    };
  }
}

function buildSuccessSnapshot(
  report: typeof enterpriseReadinessReportSchema._type
): SuccessSnapshot {
  return {
    recommendation: report.recommendation,
    guardrails: {
      euDataResidency: {
        status: report.guardrails.euDataResidency.status
      },
      enterpriseDeployment: {
        status: report.guardrails.enterpriseDeployment.status
      }
    }
  };
}

function buildSummary(results: EvalResult[]): EvalSummary {
  return {
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.outcome === 'passed').length,
      failed: results.filter((result) => result.outcome === 'failed').length,
      skipped: results.filter((result) => result.outcome === 'skipped').length
    },
    results
  };
}

function getReportDomains(
  report: typeof enterpriseReadinessReportSchema._type
): Set<string> {
  const urls = [
    ...report.guardrails.euDataResidency.evidence.map((item) => item.url),
    ...report.guardrails.enterpriseDeployment.evidence.map((item) => item.url)
  ];

  return new Set(
    urls
      .map((value) => {
        try {
          return new URL(value).hostname.toLowerCase();
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );
}

function setEquals(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function describeError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

main().catch((error) => {
  const summary: EvalSummary = {
    totals: {
      cases: 0,
      passed: 0,
      failed: 1,
      skipped: 0
    },
    results: [
      {
        caseId: '<runner>',
        category: 'infrastructure',
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: 0
      }
    ]
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 1;
});
