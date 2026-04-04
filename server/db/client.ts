import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getDatabaseUrl, isDatabaseConfigured } from './config.js';

let pool: Pool | undefined;

export function getDatabasePool() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10
    });
  }

  return pool;
}

export async function withDatabaseClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function queryDatabase<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
) {
  return getDatabasePool().query<T>(text, values);
}

export async function queryWithClient<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  values?: unknown[]
) {
  return client.query<T>(text, values);
}

export async function checkDatabaseHealth() {
  if (!isDatabaseConfigured()) {
    return {
      configured: false,
      ok: false
    };
  }

  try {
    await queryDatabase('select 1 as ok');

    return {
      configured: true,
      ok: true
    };
  } catch {
    return {
      configured: true,
      ok: false
    };
  }
}

export async function closeDatabasePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
}

export type DatabaseResult<T extends QueryResultRow = QueryResultRow> = QueryResult<T>;
