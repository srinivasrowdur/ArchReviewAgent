import type { ReadinessStatus, RecommendationLevel } from '../../shared/contracts.js';
import type { ResearchRunTracePayload } from '../research/traceArtifacts.js';
import { isDatabaseConfigured } from './config.js';
import { normalizeSubjectCacheKey } from './researchCacheRepository.js';
import { queryDatabase } from './client.js';

type ResearchRunTraceRow = {
  trace_id?: number;
  run_id: string;
  requested_subject_name: string;
  subject_key: string | null;
  canonical_subject_name: string | null;
  canonical_vendor_name: string | null;
  official_domains: string[];
  outcome: 'succeeded' | 'failed';
  recommendation: RecommendationLevel | null;
  eu_status: ReadinessStatus | null;
  enterprise_status: ReadinessStatus | null;
  cache_path: Record<string, unknown>;
  phase_timings: Record<string, number>;
  memo_length: number;
  promotion_result: Record<string, unknown> | null;
  bundle_id: string | null;
  baseline_bundle_id: string | null;
  error_phase: string | null;
  error_class: string | null;
  error_name: string | null;
  error_message: string | null;
  trace: ResearchRunTracePayload;
  created_at: string;
};

export type StoredResearchRunTrace = {
  runId: string;
  requestedSubjectName: string;
  subjectKey: string | null;
  canonicalSubjectName: string | null;
  canonicalVendorName: string | null;
  officialDomains: string[];
  outcome: 'succeeded' | 'failed';
  recommendation: RecommendationLevel | null;
  euStatus: ReadinessStatus | null;
  enterpriseStatus: ReadinessStatus | null;
  cachePath: Record<string, unknown>;
  phaseTimings: Record<string, number>;
  memoLength: number;
  promotionResult: Record<string, unknown> | null;
  bundleId: string | null;
  baselineBundleId: string | null;
  errorPhase: string | null;
  errorClass: string | null;
  errorName: string | null;
  errorMessage: string | null;
  trace: ResearchRunTracePayload;
  createdAt: string;
};

export async function storeResearchRunTrace(trace: ResearchRunTracePayload) {
  if (!isDatabaseConfigured()) {
    return;
  }

  await queryDatabase(
    `
      insert into research_run_traces (
        run_id,
        requested_subject_name,
        subject_key,
        canonical_subject_name,
        canonical_vendor_name,
        official_domains,
        outcome,
        recommendation,
        eu_status,
        enterprise_status,
        cache_path,
        phase_timings,
        memo_length,
        promotion_result,
        bundle_id,
        baseline_bundle_id,
        error_phase,
        error_class,
        error_name,
        error_message,
        trace
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12::jsonb,
        $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21::jsonb
      )
    `,
    [
      trace.runId,
      trace.requestedSubjectName,
      trace.subjectKey,
      trace.canonicalSubjectName,
      trace.canonicalVendorName,
      JSON.stringify(trace.officialDomains),
      trace.outcome,
      trace.recommendation,
      trace.guardrails.euDataResidency?.status ?? null,
      trace.guardrails.enterpriseDeployment?.status ?? null,
      JSON.stringify(trace.cachePath),
      JSON.stringify(trace.phaseTimings),
      trace.memoLength,
      JSON.stringify(trace.promotionResult),
      trace.bundleId,
      trace.baselineBundleId,
      trace.error?.phase ?? null,
      trace.error?.errorClass ?? null,
      trace.error?.errorName ?? null,
      trace.error?.errorMessage ?? null,
      JSON.stringify(trace)
    ]
  );
}

export async function loadResearchRunTrace(runId: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const result = await queryDatabase<ResearchRunTraceRow>(
    `
      select
        trace_id,
        run_id,
        requested_subject_name,
        subject_key,
        canonical_subject_name,
        canonical_vendor_name,
        official_domains,
        outcome,
        recommendation,
        eu_status,
        enterprise_status,
        cache_path,
        phase_timings,
        memo_length,
        promotion_result,
        bundle_id,
        baseline_bundle_id,
        error_phase,
        error_class,
        error_name,
        error_message,
        trace,
        created_at
      from research_run_traces
      where run_id = $1
      order by created_at desc, trace_id desc
      limit 1
    `,
    [runId]
  );

  return mapResearchRunTraceRow(result.rows[0] ?? null);
}

export async function listResearchRunTraces(options: {
  subjectName?: string;
  limit?: number;
} = {}) {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const values: unknown[] = [];
  const predicates: string[] = [];

  if (options.subjectName?.trim()) {
    values.push(normalizeSubjectCacheKey(options.subjectName));
    predicates.push(`subject_key = $${values.length}`);
  }

  values.push(normalizeTraceListLimit(options.limit));
  const limitPlaceholder = `$${values.length}`;
  const whereClause =
    predicates.length > 0 ? `where ${predicates.join(' and ')}` : '';

  const result = await queryDatabase<ResearchRunTraceRow>(
    `
      select
        trace_id,
        run_id,
        requested_subject_name,
        subject_key,
        canonical_subject_name,
        canonical_vendor_name,
        official_domains,
        outcome,
        recommendation,
        eu_status,
        enterprise_status,
        cache_path,
        phase_timings,
        memo_length,
        promotion_result,
        bundle_id,
        baseline_bundle_id,
        error_phase,
        error_class,
        error_name,
        error_message,
        trace,
        created_at
      from research_run_traces
      ${whereClause}
      order by created_at desc, trace_id desc
      limit ${limitPlaceholder}
    `,
    values
  );

  return result.rows.map((row) => mapResearchRunTraceRow(row)!);
}

function normalizeTraceListLimit(limit: number | undefined) {
  if (!Number.isFinite(limit) || (limit ?? 0) <= 0) {
    return 10;
  }

  return Math.min(Math.trunc(limit ?? 10), 100);
}

function mapResearchRunTraceRow(row: ResearchRunTraceRow | null): StoredResearchRunTrace | null {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    requestedSubjectName: row.requested_subject_name,
    subjectKey: row.subject_key,
    canonicalSubjectName: row.canonical_subject_name,
    canonicalVendorName: row.canonical_vendor_name,
    officialDomains: row.official_domains,
    outcome: row.outcome,
    recommendation: row.recommendation,
    euStatus: row.eu_status,
    enterpriseStatus: row.enterprise_status,
    cachePath: row.cache_path,
    phaseTimings: row.phase_timings,
    memoLength: row.memo_length,
    promotionResult: row.promotion_result,
    bundleId: row.bundle_id,
    baselineBundleId: row.baseline_bundle_id,
    errorPhase: row.error_phase,
    errorClass: row.error_class,
    errorName: row.error_name,
    errorMessage: row.error_message,
    trace: row.trace,
    createdAt: row.created_at
  };
}
