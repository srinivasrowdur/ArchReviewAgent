import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabaseUrl } from './config.js';
import { closeDatabasePool, withDatabaseClient, queryWithClient } from './client.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(currentDir, 'migrations');

async function main() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set before running migrations.');
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  await withDatabaseClient(async (client) => {
    await queryWithClient(
      client,
      `
        create table if not exists schema_migrations (
          version text primary key,
          applied_at timestamptz not null default now()
        )
      `
    );

    for (const file of files) {
      const version = file.replace(/\.sql$/i, '');
      const existing = await queryWithClient<{ version: string }>(
        client,
        'select version from schema_migrations where version = $1',
        [version]
      );

      if (existing.rowCount) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');

      await queryWithClient(client, 'begin');

      try {
        await queryWithClient(client, sql);
        await queryWithClient(
          client,
          'insert into schema_migrations (version) values ($1)',
          [version]
        );
        await queryWithClient(client, 'commit');
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await queryWithClient(client, 'rollback');
        throw error;
      }
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
