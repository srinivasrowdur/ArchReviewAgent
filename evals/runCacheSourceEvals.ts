import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cacheSourceCaseSchema, type CacheSourceCase } from './cacheSourceCaseSchema.js';
import { evaluateCandidateReport } from '../server/research/cachePolicy.js';
import {
  buildVendorResolutionCacheEntries,
  pickMostCompleteVendorResolutionRow
} from '../server/db/researchCacheRepository.js';
import {
  isAllowedVendorHostname,
  normalizeEvidenceUrl
} from '../server/research/sourceSafety.js';

type EvalResult =
  | { caseId: string; category: CacheSourceCase['category']; outcome: 'passed'; detail: string; durationMs: number }
  | { caseId: string; category: CacheSourceCase['category']; outcome: 'failed'; detail: string; durationMs: number };

type EvalSummary = {
  totals: {
    cases: number;
    passed: number;
    failed: number;
  };
  results: EvalResult[];
};

async function main() {
  const inputPaths = process.argv.slice(2);
  const casePaths =
    inputPaths.length > 0 ? inputPaths : ['evals/cases/cache-source-deterministic.jsonl'];
  const cases = await loadCases(casePaths);
  const results = cases.map(runCase);
  const summary = {
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.outcome === 'passed').length,
      failed: results.filter((result) => result.outcome === 'failed').length
    },
    results
  } satisfies EvalSummary;

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

async function loadCases(inputPaths: string[]) {
  const loaded: CacheSourceCase[] = [];

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    const content = await readFile(absolutePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    for (const [index, line] of lines.entries()) {
      try {
        loaded.push(cacheSourceCaseSchema.parse(JSON.parse(line)));
      } catch (error) {
        throw new Error(
          `Invalid cache/source eval case in ${absolutePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return loaded;
}

function runCase(testCase: CacheSourceCase): EvalResult {
  const startedAt = Date.now();

  try {
    switch (testCase.category) {
      case 'cache-promotion': {
        const decision = evaluateCandidateReport(testCase.candidate, testCase.baseline);
        assertEqual(decision.promoteCandidate, testCase.expected.promoteCandidate, 'promoteCandidate mismatch');
        assertEqual(decision.reason, testCase.expected.reason, 'promotion reason mismatch');

        if ((testCase.expected.detail ?? '') !== (decision.detail ?? '')) {
          throw new Error(
            `promotion detail mismatch: expected ${JSON.stringify(testCase.expected.detail ?? '')}, got ${JSON.stringify(decision.detail ?? '')}`
          );
        }

        return passed(
          testCase,
          'Cache promotion decision matched expected output.',
          Date.now() - startedAt
        );
      }

      case 'cache-convergence': {
        const entries = buildVendorResolutionCacheEntries(
          testCase.requestedSubjectName,
          testCase.canonicalName
        );
        const keys = entries.map((entry) => entry.subjectKey);
        const winningRow = pickMostCompleteVendorResolutionRow(testCase.rows);

        if (!winningRow) {
          throw new Error('Expected a winning vendor resolution row.');
        }

        assertArrayEqual(keys, testCase.expected.cacheKeys, 'cache key list mismatch');
        assertArrayEqual(
          winningRow.official_domains,
          testCase.expected.winningDomains,
          'winning domain set mismatch'
        );

        return passed(
          testCase,
          'Cache-key convergence and strongest-row selection matched expected output.',
          Date.now() - startedAt
        );
      }

      case 'source-safety': {
        const normalizedUrl = normalizeEvidenceUrl(testCase.url, testCase.allowedDomains);
        const hostnameAllowed = isAllowedVendorHostname(
          new URL(testCase.url).hostname,
          testCase.allowedDomains
        );

        assertEqual(normalizedUrl, testCase.expected.normalizedUrl, 'normalized URL mismatch');
        assertEqual(hostnameAllowed, testCase.expected.allowed, 'hostname allow result mismatch');

        return passed(
          testCase,
          'Source-safety normalization matched expected output.',
          Date.now() - startedAt
        );
      }
    }
  } catch (error) {
    return {
      caseId: testCase.id,
      category: testCase.category,
      outcome: 'failed',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

function passed(
  testCase: CacheSourceCase,
  detail: string,
  durationMs: number
): EvalResult {
  return {
    caseId: testCase.id,
    category: testCase.category,
    outcome: 'passed',
    detail,
    durationMs
  };
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(actual: string[], expected: string[], label: string) {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
}

main().catch((error) => {
  const summary: EvalSummary = {
    totals: {
      cases: 0,
      passed: 0,
      failed: 1
    },
    results: [
      {
        caseId: '<runner>',
        category: 'cache-promotion',
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: 0
      }
    ]
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = 1;
});
