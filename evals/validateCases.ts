import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ZodError } from 'zod';
import { evalCaseSchema } from './caseSchema.js';

async function main() {
  const args = process.argv.slice(2);
  const requestedPaths = args.length > 0 ? args : ['evals/cases'];
  const jsonlFiles = await collectJsonlFiles(requestedPaths);

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
        evalCaseSchema.parse(parsedJson);
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

async function collectJsonlFiles(inputPaths: string[]) {
  const discovered = new Set<string>();

  for (const inputPath of inputPaths) {
    const absolutePath = path.resolve(inputPath);
    await collectJsonlFilesFromPath(absolutePath, discovered);
  }

  return [...discovered].sort();
}

async function collectJsonlFilesFromPath(
  absolutePath: string,
  discovered: Set<string>
) {
  const entry = await stat(absolutePath);

  if (entry.isDirectory()) {
    const children = await readdir(absolutePath, { withFileTypes: true });

    for (const child of children) {
      await collectJsonlFilesFromPath(
        path.join(absolutePath, child.name),
        discovered
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
