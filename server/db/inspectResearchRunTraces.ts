import 'dotenv/config';

import process from 'node:process';
import {
  listResearchRunTraces,
  loadResearchRunTrace
} from './researchRunTraceRepository.js';
import { closeDatabasePool } from './client.js';
import { getDatabaseUrl } from './config.js';

async function main() {
  if (!getDatabaseUrl()) {
    throw new Error('DATABASE_URL must be set before inspecting stored traces.');
  }

  const args = process.argv.slice(2);
  const runId = readFlag(args, '--run-id');
  const subjectName = readFlag(args, '--subject');
  const limitValue = readFlag(args, '--limit');

  const payload = runId
    ? await loadResearchRunTrace(runId)
    : await listResearchRunTraces({
        subjectName,
        limit: limitValue ? Number(limitValue) : undefined
      });

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (!payload || (Array.isArray(payload) && payload.length === 0)) {
    process.exitCode = 1;
  }
}

function readFlag(args: string[], flag: string) {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
