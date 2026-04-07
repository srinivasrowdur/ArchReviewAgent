import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { EvalCase } from './caseSchema.js';
import { evalCaseSchema } from './caseSchema.js';
import { createMockReport } from '../server/mockReport.js';
import { enterpriseReadinessReportSchema } from '../server/research/reportSchema.js';
import {
  InvalidVendorInputError
} from '../server/research/errors.js';
import { validateVendorInput } from '../server/research/vendorIntake.js';

type EvalResult =
  | {
      caseId: string;
      category: string;
      outcome: 'passed';
      detail: string;
    }
  | {
      caseId: string;
      category: string;
      outcome: 'failed';
      detail: string;
    }
  | {
      caseId: string;
      category: string;
      outcome: 'skipped';
      detail: string;
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

async function main() {
  const inputPaths = process.argv.slice(2);
  const casePaths =
    inputPaths.length > 0 ? inputPaths : ['evals/cases/release-core.jsonl'];
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
  if (evalCase.expected_outcome === 'success') {
    try {
      const report = createMockReport(evalCase.input);
      enterpriseReadinessReportSchema.parse(report);

      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'passed',
        detail: 'Mock backend report satisfied the report contract.'
      };
    } catch (error) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail: describeError(error, 'Mock backend report did not satisfy the report contract.')
      };
    }
  }

  if (evalCase.expected_error.status !== 400) {
    return {
      caseId: evalCase.id,
      category: evalCase.category,
      outcome: 'skipped',
      detail:
        'Deterministic release evals currently cover only synchronous input-validation rejections.'
    };
  }

  try {
    validateVendorInput(evalCase.input);

    return {
      caseId: evalCase.id,
      category: evalCase.category,
      outcome: 'failed',
      detail: `Expected a 400 rejection containing "${evalCase.expected_error.message_includes}", but validation accepted the input.`
    };
  } catch (error) {
    if (!(error instanceof InvalidVendorInputError)) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail: describeError(
          error,
          `Expected InvalidVendorInputError with message containing "${evalCase.expected_error.message_includes}".`
        )
      };
    }

    if (!error.message.includes(evalCase.expected_error.message_includes)) {
      return {
        caseId: evalCase.id,
        category: evalCase.category,
        outcome: 'failed',
        detail:
          `Expected rejection message containing "${evalCase.expected_error.message_includes}", got "${error.message}".`
      };
    }

    return {
      caseId: evalCase.id,
      category: evalCase.category,
      outcome: 'passed',
      detail: 'Input validation rejected the request as expected.'
    };
  }
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
        detail: error instanceof Error ? error.message : String(error)
      }
    ]
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 1;
});
