create table if not exists research_run_traces (
  trace_id bigserial primary key,
  run_id text not null,
  requested_subject_name text not null,
  subject_key text,
  canonical_subject_name text,
  canonical_vendor_name text,
  official_domains jsonb not null default '[]'::jsonb,
  outcome text not null check (outcome in ('succeeded', 'failed')),
  recommendation text check (recommendation in ('green', 'yellow', 'red')),
  eu_status text check (eu_status in ('supported', 'partial', 'unsupported', 'unknown')),
  enterprise_status text check (enterprise_status in ('supported', 'partial', 'unsupported', 'unknown')),
  cache_path jsonb not null default '{}'::jsonb,
  phase_timings jsonb not null default '{}'::jsonb,
  memo_length integer not null default 0,
  promotion_result jsonb,
  bundle_id text,
  baseline_bundle_id text,
  error_phase text,
  error_class text,
  error_name text,
  error_message text,
  trace jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists research_run_traces_created_idx
  on research_run_traces (created_at desc);

create index if not exists research_run_traces_run_id_idx
  on research_run_traces (run_id, created_at desc, trace_id desc);

create index if not exists research_run_traces_subject_idx
  on research_run_traces (subject_key, created_at desc, trace_id desc);

create index if not exists research_run_traces_outcome_idx
  on research_run_traces (outcome, created_at desc, trace_id desc);
