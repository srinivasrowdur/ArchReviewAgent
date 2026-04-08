import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ZodError } from 'zod';
import { evalCaseSchema } from './caseSchema.js';
import { cacheSourceCaseSchema } from './cacheSourceCaseSchema.js';
import { publicSurfaceCaseSchema } from './publicSurfaceCaseSchema.js';

async function main() {
  const args = process.argv.slice(2);
  const requestedPaths = args.length > 0 ? args : ['evals/cases'];
  const jsonlFiles = await collectJsonlFiles(requestedPaths, {
    skipFixtureDirectories: args.length === 0
  });

  if (jsonlFiles.length === 0) {
    throw new Error('No JSONL case files found.');
  }

  let checkedCases = 0;

  for (const filePath of jsonlFiles) {
    const content = await readFile(filePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error(`No cases found in ${filePath}.`);
    }

    for (const [index, line] of lines.entries()) {
      checkedCases += 1;

      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON in ${filePath}:${index + 1}: ${String(error)}`
        );
      }

      try {
        parseKnownEvalCase(parsedJson);
      } catch (error) {
        if (error instanceof ZodError) {
          const details = error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; ');

          throw new Error(
            `Invalid eval case in ${filePath}:${index + 1}: ${details}`
          );
        }

        throw error;
      }
    }
  }

  console.log(
    `Validated ${checkedCases} eval case${checkedCases === 1 ? '' : 's'} across ${jsonlFiles.length} file${jsonlFiles.length === 1 ? '' : 's'}.`
  );
}

function parseKnownEvalCase(parsedJson: unknown) {
  if (hasExpectedOutcome(parsedJson)) {
    return evalCaseSchema.parse(parsedJson);
  }

  if (hasCategory(parsedJson)) {
    if (isCacheSourceCategory(parsedJson.category)) {
      return cacheSourceCaseSchema.parse(parsedJson);
    }

    if (isPublicSurfaceCategory(parsedJson.category)) {
      return publicSurfaceCaseSchema.parse(parsedJson);
    }

    return publicSurfaceCaseSchema.parse(parsedJson);
  }

  try {
    return evalCaseSchema.parse(parsedJson);
  } catch (releaseError) {
    if (!(releaseError instanceof ZodError)) {
      throw releaseError;
    }

    return cacheSourceCaseSchema.parse(parsedJson);
  }
}

function hasExpectedOutcome(
  value: unknown
): value is { expected_outcome: unknown } {
  return typeof value === 'object' && value !== null && 'expected_outcome' in value;
}

function hasCategory(value: unknown): value is { category: unknown } {
  return typeof value === 'object' && value !== null && 'category' in value;
}

function isCacheSourceCategory(value: unknown) {
  return (
    value === 'cache-promotion' ||
    value === 'cache-convergence' ||
    value === 'source-safety'
  );
}

function isPublicSurfaceCategory(value: unknown) {
  return (
    value === 'cors' ||
    value === 'security-headers' ||
    value === 'endpoint-exposure'
  );
}

type CollectJsonlOptions = {
  skipFixtureDirectories: boolean;
};

async function collectJsonlFiles(
  inputPaths: string[],
  options: CollectJsonlOptions
) {
  const discovered = new Set<string>();

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    await collectJsonlFilesFromPath(absolutePath, discovered, options);
  }

  return [...discovered].sort();
}

async function collectJsonlFilesFromPath(
  absolutePath: string,
  discovered: Set<string>,
  options: CollectJsonlOptions
) {
  const entry = await stat(absolutePath);

  if (entry.isDirectory()) {
    if (
      options.skipFixtureDirectories &&
      path.basename(absolutePath) === '_fixtures'
    ) {
      return;
    }

    const children = await readdir(absolutePath, { withFileTypes: true });

    for (const child of children) {
      await collectJsonlFilesFromPath(
        path.join(absolutePath, child.name),
        discovered,
        options
      );
    }

    return;
  }

  if (absolutePath.endsWith('.jsonl')) {
    discovered.add(absolutePath);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
