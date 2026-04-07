import { randomUUID } from 'node:crypto';
import type {
  EnterpriseReadinessReport,
  GuardrailAssessment
} from '../../shared/contracts.js';
import type { VendorResolution } from '../research/vendorIntake.js';
import { getEvidenceCacheTtlMs, getResolutionCacheTtlMs, isDatabaseConfigured } from './config.js';
import { queryDatabase, withDatabaseClient, queryWithClient } from './client.js';

type CachedResolutionRow = {
  requested_subject_name: string;
  canonical_name: string;
  official_domains: string[];
  confidence: VendorResolution['confidence'];
  alternatives: string[];
  rationale: string;
};

type CachedReportRow = {
  bundle_id: string;
  memo: string;
  fetched_at: string;
  expires_at: string;
  report: EnterpriseReadinessReport;
};

export type CachedReportSnapshot = {
  bundleId: string;
  memo: string;
  fetchedAt: string;
  expiresAt: string;
  report: EnterpriseReadinessReport;
};

export async function loadCachedVendorResolution(requestedSubjectName: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const subjectKey = normalizeSubjectCacheKey(requestedSubjectName);
  const row = await loadCachedVendorResolutionRowByKey(subjectKey);

  if (!row) {
    return null;
  }

  const canonicalSubjectKey = normalizeSubjectCacheKey(row.canonical_name);
  const canonicalRow =
    canonicalSubjectKey === subjectKey
      ? row
      : await loadCachedVendorResolutionRowByKey(canonicalSubjectKey);

  return mapCachedVendorResolutionRow(
    pickMostCompleteVendorResolutionRow(canonicalRow ? [row, canonicalRow] : [row])
  );
}

export async function storeVendorResolution(
  requestedSubjectName: string,
  resolution: VendorResolution
) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const expiresAt = new Date(Date.now() + getResolutionCacheTtlMs());
  const cacheEntries = buildVendorResolutionCacheEntries(
    requestedSubjectName,
    resolution.canonicalName
  );
  const existingRows = await loadCachedVendorResolutionRowsByKeys(
    cacheEntries.map((entry) => entry.subjectKey)
  );
  const persistedResolution = pickMostCompleteVendorResolution([
    ...existingRows
      .map((row) => mapCachedVendorResolutionRow(row))
      .filter((row): row is VendorResolution => row !== null),
    resolution
  ]);

  await withDatabaseClient(async (client) => {
    await queryWithClient(client, 'begin');

    try {
      for (const entry of cacheEntries) {
        await queryWithClient(
          client,
          `
            insert into subject_resolution_cache (
              subject_key,
              requested_subject_name,
              canonical_name,
              official_domains,
              confidence,
              alternatives,
              rationale,
              expires_at
            ) values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8)
            on conflict (subject_key) do update set
              requested_subject_name = excluded.requested_subject_name,
              canonical_name = excluded.canonical_name,
              official_domains = excluded.official_domains,
              confidence = excluded.confidence,
              alternatives = excluded.alternatives,
              rationale = excluded.rationale,
              created_at = now(),
              expires_at = excluded.expires_at
          `,
          [
            entry.subjectKey,
            entry.requestedSubjectName,
            persistedResolution.canonicalName,
            JSON.stringify(persistedResolution.officialDomains),
            persistedResolution.confidence,
            JSON.stringify(persistedResolution.alternatives),
            persistedResolution.rationale,
            expiresAt.toISOString()
          ]
        );
      }

      await queryWithClient(client, 'commit');
    } catch (error) {
      await queryWithClient(client, 'rollback');
      throw error;
    }
  });
}

export async function loadAcceptedReportSnapshot(
  subjectKey: string
): Promise<CachedReportSnapshot | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const result = await queryDatabase<CachedReportRow>(
    `
      select
        bundles.id as bundle_id,
        bundles.memo,
        bundles.fetched_at,
        bundles.expires_at,
        snapshots.report
      from evidence_bundles bundles
      join decision_snapshots snapshots
        on snapshots.evidence_bundle_id = bundles.id
      where bundles.subject_key = $1
        and bundles.status = 'accepted'
        and bundles.expires_at > now()
      order by bundles.fetched_at desc
      limit 1
    `,
    [subjectKey]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    bundleId: row.bundle_id,
    memo: row.memo,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    report: row.report
  };
}

export async function loadLatestAcceptedReportSnapshot(
  subjectKey: string
): Promise<CachedReportSnapshot | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const result = await queryDatabase<CachedReportRow>(
    `
      select
        bundles.id as bundle_id,
        bundles.memo,
        bundles.fetched_at,
        bundles.expires_at,
        snapshots.report
      from evidence_bundles bundles
      join decision_snapshots snapshots
        on snapshots.evidence_bundle_id = bundles.id
      where bundles.subject_key = $1
        and bundles.status = 'accepted'
      order by bundles.fetched_at desc
      limit 1
    `,
    [subjectKey]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    bundleId: row.bundle_id,
    memo: row.memo,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    report: row.report
  };
}

export async function storeResearchArtifacts(input: {
  subjectKey: string;
  requestedSubjectName: string;
  resolution: VendorResolution;
  memo: string;
  report: EnterpriseReadinessReport;
  statusOverride?: 'accepted' | 'weak' | 'stale';
}) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const bundleId = randomUUID();
  const snapshotId = randomUUID();
  const fetchedAt = normalizeIsoTimestamp(input.report.researchedAt);
  const expiresAt = new Date(Date.now() + getEvidenceCacheTtlMs()).toISOString();
  const status = input.statusOverride ?? classifyBundleStatus(input.report);
  const coverageSummary = buildCoverageSummary(input.report);

  await withDatabaseClient(async (client) => {
    await queryWithClient(client, 'begin');

    try {
      await queryWithClient(
        client,
        `
          insert into evidence_bundles (
            id,
            subject_key,
            requested_subject_name,
            canonical_name,
            official_domains,
            memo,
            status,
            coverage_summary,
            fetched_at,
            expires_at
          ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10)
        `,
        [
          bundleId,
          input.subjectKey,
          input.requestedSubjectName,
          input.resolution.canonicalName,
          JSON.stringify(input.resolution.officialDomains),
          input.memo,
          status,
          JSON.stringify(coverageSummary),
          fetchedAt,
          expiresAt
        ]
      );

      for (const [guardrailKey, assessment] of getAssessmentEntries(input.report)) {
        for (const evidenceItem of assessment.evidence) {
          await queryWithClient(
            client,
            `
              insert into evidence_items (
                evidence_bundle_id,
                guardrail_key,
                title,
                url,
                publisher,
                finding,
                source_type
              ) values ($1, $2, $3, $4, $5, $6, $7)
            `,
            [
              bundleId,
              guardrailKey,
              evidenceItem.title,
              evidenceItem.url,
              evidenceItem.publisher,
              evidenceItem.finding,
              evidenceItem.sourceType
            ]
          );
        }
      }

      await queryWithClient(
        client,
        `
          insert into decision_snapshots (
            id,
            evidence_bundle_id,
            company_name,
            recommendation,
            report,
            researched_at
          ) values ($1, $2, $3, $4, $5::jsonb, $6)
        `,
        [
          snapshotId,
          bundleId,
          input.report.companyName,
          input.report.recommendation,
          JSON.stringify(input.report),
          fetchedAt
        ]
      );

      await queryWithClient(client, 'commit');
    } catch (error) {
      await queryWithClient(client, 'rollback');
      throw error;
    }
  });

  return {
    bundleId,
    status
  };
}

export async function renewAcceptedReportSnapshot(bundleId: string) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const expiresAt = new Date(Date.now() + getEvidenceCacheTtlMs()).toISOString();

  await queryDatabase(
    `
      update evidence_bundles
      set expires_at = $2
      where id = $1
        and status = 'accepted'
    `,
    [bundleId, expiresAt]
  );
}

export function normalizeSubjectCacheKey(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildVendorResolutionCacheEntries(
  requestedSubjectName: string,
  canonicalName: string
) {
  const requestedSubjectKey = normalizeSubjectCacheKey(requestedSubjectName);
  const canonicalSubjectKey = normalizeSubjectCacheKey(canonicalName);
  const entries = [
    {
      subjectKey: requestedSubjectKey,
      requestedSubjectName
    }
  ];

  if (canonicalSubjectKey !== requestedSubjectKey) {
    entries.push({
      subjectKey: canonicalSubjectKey,
      requestedSubjectName: canonicalName
    });
  }

  return entries;
}

export function pickMostCompleteVendorResolutionRow<T extends CachedResolutionRow>(
  rows: readonly T[]
) {
  if (rows.length === 0) {
    return null;
  }

  return rows.reduce((bestRow, row) =>
    compareVendorResolutionRows(row, bestRow) > 0 ? row : bestRow
  );
}

export function pickMostCompleteVendorResolution(
  resolutions: readonly VendorResolution[]
) {
  if (resolutions.length === 0) {
    throw new Error('At least one vendor resolution is required.');
  }

  return resolutions.reduce((bestResolution, resolution) =>
    compareVendorResolutions(resolution, bestResolution) > 0 ? resolution : bestResolution
  );
}

function classifyBundleStatus(report: EnterpriseReadinessReport) {
  const assessments = getAssessmentEntries(report).map(([, assessment]) => assessment);
  const hasUnknown = assessments.some((assessment) => assessment.status === 'unknown');
  const hasEvidence = assessments.some((assessment) => assessment.evidence.length > 0);

  if (hasUnknown || !hasEvidence) {
    return 'weak' as const;
  }

  return 'accepted' as const;
}

function buildCoverageSummary(report: EnterpriseReadinessReport) {
  return Object.fromEntries(
    getAssessmentEntries(report).map(([guardrailKey, assessment]) => [
      guardrailKey,
      {
        status: assessment.status,
        confidence: assessment.confidence,
        evidenceCount: assessment.evidence.length
      }
    ])
  );
}

function getAssessmentEntries(report: EnterpriseReadinessReport) {
  return [
    ['euDataResidency', report.guardrails.euDataResidency],
    ['enterpriseDeployment', report.guardrails.enterpriseDeployment]
  ] as const satisfies ReadonlyArray<
    readonly [guardrailKey: 'euDataResidency' | 'enterpriseDeployment', assessment: GuardrailAssessment]
  >;
}

function normalizeIsoTimestamp(value: string) {
  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }

  return new Date(parsed).toISOString();
}

async function loadCachedVendorResolutionRowByKey(subjectKey: string) {
  const result = await queryDatabase<CachedResolutionRow>(
    `
      select
        requested_subject_name,
        canonical_name,
        official_domains,
        confidence,
        alternatives,
        rationale
      from subject_resolution_cache
      where subject_key = $1
        and expires_at > now()
      limit 1
    `,
    [subjectKey]
  );

  return result.rows[0] ?? null;
}

async function loadCachedVendorResolutionRowsByKeys(subjectKeys: readonly string[]) {
  const result = await queryDatabase<CachedResolutionRow>(
    `
      select
        requested_subject_name,
        canonical_name,
        official_domains,
        confidence,
        alternatives,
        rationale
      from subject_resolution_cache
      where subject_key = any($1::text[])
        and expires_at > now()
    `,
    [subjectKeys]
  );

  return result.rows;
}

function mapCachedVendorResolutionRow(row: CachedResolutionRow | null) {
  if (!row) {
    return null;
  }

  return {
    canonicalName: row.canonical_name,
    officialDomains: row.official_domains,
    confidence: row.confidence,
    alternatives: row.alternatives,
    rationale: row.rationale
  } satisfies VendorResolution;
}

function compareVendorResolutionRows(left: CachedResolutionRow, right: CachedResolutionRow) {
  const confidenceDelta = getConfidenceRank(left.confidence) - getConfidenceRank(right.confidence);

  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  const domainDelta = left.official_domains.length - right.official_domains.length;

  if (domainDelta !== 0) {
    return domainDelta;
  }

  const leftIsCanonicalEntry =
    normalizeSubjectCacheKey(left.requested_subject_name) === normalizeSubjectCacheKey(left.canonical_name);
  const rightIsCanonicalEntry =
    normalizeSubjectCacheKey(right.requested_subject_name) ===
    normalizeSubjectCacheKey(right.canonical_name);

  return Number(leftIsCanonicalEntry) - Number(rightIsCanonicalEntry);
}

function compareVendorResolutions(left: VendorResolution, right: VendorResolution) {
  const confidenceDelta = getConfidenceRank(left.confidence) - getConfidenceRank(right.confidence);

  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  return left.officialDomains.length - right.officialDomains.length;
}

function getConfidenceRank(confidence: VendorResolution['confidence']) {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
    default:
      return 1;
  }
}
