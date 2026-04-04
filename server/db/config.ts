const DEFAULT_EVIDENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RESOLUTION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() ?? '';
}

export function isDatabaseConfigured() {
  return getDatabaseUrl().length > 0;
}

export function getEvidenceCacheTtlMs() {
  return parsePositiveNumber(process.env.EVIDENCE_CACHE_TTL_MS, DEFAULT_EVIDENCE_CACHE_TTL_MS);
}

export function getResolutionCacheTtlMs() {
  return parsePositiveNumber(
    process.env.RESOLUTION_CACHE_TTL_MS,
    DEFAULT_RESOLUTION_CACHE_TTL_MS
  );
}

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
