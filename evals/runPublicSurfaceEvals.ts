import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createEnterpriseApp } from '../server/app.js';
import { publicSurfaceCaseSchema, type PublicSurfaceCase } from './publicSurfaceCaseSchema.js';

type EvalResult =
  | {
      caseId: string;
      category: PublicSurfaceCase['category'];
      outcome: 'passed';
      detail: string;
    }
  | {
      caseId: string;
      category: PublicSurfaceCase['category'];
      outcome: 'failed';
      detail: string;
    };

type EvalSummary = {
  totals: {
    cases: number;
    passed: number;
    failed: number;
  };
  results: EvalResult[];
};

type RunPublicSurfaceEvalOptions = {
  baseUrl?: string;
  casePaths?: string[];
};

export async function runPublicSurfaceSmokeSuite(
  {
    baseUrl,
    casePaths = ['evals/cases/public-surface-deterministic.jsonl']
  }: RunPublicSurfaceEvalOptions = {}
) {
  const cases = await loadPublicSurfaceCases(casePaths);

  if (baseUrl) {
    return evaluatePublicSurfaceCases(baseUrl, cases);
  }

  const server = createEnterpriseApp({
    nodeEnv: 'production',
    configuredAllowedOrigins: new Set(['https://trusted.example']),
    internalApiToken: 'internal-secret',
    serveStatic: false,
    checkDatabaseHealthFn: async () => ({
      configured: true,
      ok: true
    })
  }).listen(0, '127.0.0.1');

  await once(server, 'listening');

  try {
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP port for public-surface evals.');
    }

    return await evaluatePublicSurfaceCases(
      `http://127.0.0.1:${address.port}`,
      cases
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

export async function evaluatePublicSurfaceCases(
  baseUrl: string,
  cases: PublicSurfaceCase[]
) {
  const results: EvalResult[] = [];

  for (const testCase of cases) {
    results.push(await runCase(baseUrl, testCase));
  }

  return buildSummary(results);
}

async function loadPublicSurfaceCases(inputPaths: string[]) {
  const discoveredCases: PublicSurfaceCase[] = [];

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

      discoveredCases.push(publicSurfaceCaseSchema.parse(parsedJson));
    }
  }

  return discoveredCases;
}

async function runCase(
  baseUrl: string,
  testCase: PublicSurfaceCase
): Promise<EvalResult> {
  try {
    const headers = new Headers(testCase.request.headers);
    const requestInit: RequestInit = {
      method: testCase.request.method,
      headers
    };

    if (testCase.request.body !== undefined) {
      requestInit.body = JSON.stringify(testCase.request.body);
    }

    const response = await fetch(`${baseUrl}${testCase.request.path}`, requestInit);

    assert.equal(
      response.status,
      testCase.expected.status,
      `expected status ${testCase.expected.status}, got ${response.status}`
    );

    for (const [headerName, expectedValue] of Object.entries(
      testCase.expected.requiredHeaders
    )) {
      assert.equal(
        response.headers.get(headerName),
        expectedValue,
        `expected header ${headerName}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(response.headers.get(headerName))}`
      );
    }

    for (const [headerName, expectedSubstrings] of Object.entries(
      testCase.expected.headerContains
    )) {
      const headerValue = response.headers.get(headerName) ?? '';

      for (const expectedSubstring of expectedSubstrings) {
        assert.ok(
          headerValue.includes(expectedSubstring),
          `expected header ${headerName} to include ${JSON.stringify(expectedSubstring)}, got ${JSON.stringify(headerValue)}`
        );
      }
    }

    for (const headerName of testCase.expected.absentHeaders) {
      assert.equal(
        response.headers.get(headerName),
        null,
        `expected header ${headerName} to be absent, got ${JSON.stringify(response.headers.get(headerName))}`
      );
    }

    if (testCase.expected.jsonBody !== undefined) {
      const jsonBody = await response.json();

      assert.deepEqual(
        jsonBody,
        testCase.expected.jsonBody,
        'JSON response body did not match expected payload'
      );
    }

    return {
      caseId: testCase.id,
      category: testCase.category,
      outcome: 'passed',
      detail: 'Public surface behavior matched expected output.'
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      category: testCase.category,
      outcome: 'failed',
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildSummary(results: EvalResult[]): EvalSummary {
  return {
    totals: {
      cases: results.length,
      passed: results.filter((result) => result.outcome === 'passed').length,
      failed: results.filter((result) => result.outcome === 'failed').length
    },
    results
  };
}

async function main() {
  const inputPaths = process.argv.slice(2);
  const summary = await runPublicSurfaceSmokeSuite({
    casePaths: inputPaths.length > 0 ? inputPaths : undefined
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
          category: 'endpoint-exposure',
          outcome: 'failed',
          detail: error instanceof Error ? error.message : String(error)
        }
      ]
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
  });
}
