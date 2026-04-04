create table if not exists subject_resolution_cache (
  subject_key text primary key,
  requested_subject_name text not null,
  canonical_name text not null,
  official_domains jsonb not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  alternatives jsonb not null default '[]'::jsonb,
  rationale text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists subject_resolution_cache_expires_idx
  on subject_resolution_cache (expires_at desc);

create table if not exists evidence_bundles (
  id text primary key,
  subject_key text not null,
  requested_subject_name text not null,
  canonical_name text not null,
  official_domains jsonb not null,
  memo text not null,
  status text not null check (status in ('accepted', 'weak', 'stale')),
  coverage_summary jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists evidence_bundles_subject_idx
  on evidence_bundles (subject_key, fetched_at desc);

create index if not exists evidence_bundles_expires_idx
  on evidence_bundles (expires_at desc);

create table if not exists evidence_items (
  id bigserial primary key,
  evidence_bundle_id text not null references evidence_bundles(id) on delete cascade,
  guardrail_key text not null check (guardrail_key in ('euDataResidency', 'enterpriseDeployment')),
  title text not null,
  url text not null,
  publisher text not null,
  finding text not null,
  source_type text not null check (source_type in ('primary', 'secondary')),
  created_at timestamptz not null default now()
);

create index if not exists evidence_items_bundle_idx
  on evidence_items (evidence_bundle_id, guardrail_key);

create table if not exists decision_snapshots (
  id text primary key,
  evidence_bundle_id text not null references evidence_bundles(id) on delete cascade,
  company_name text not null,
  recommendation text not null check (recommendation in ('green', 'yellow', 'red')),
  report jsonb not null,
  researched_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists decision_snapshots_bundle_idx
  on decision_snapshots (evidence_bundle_id);
