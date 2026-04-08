do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'research_run_traces'
      and column_name = 'trace_id'
  ) then
    return;
  end if;

  alter table research_run_traces
    add column trace_id bigserial;

  alter table research_run_traces
    drop constraint research_run_traces_pkey;

  alter table research_run_traces
    add constraint research_run_traces_pkey primary key (trace_id);

  alter table research_run_traces
    alter column run_id set not null;
end
$$;

create index if not exists research_run_traces_run_id_idx
  on research_run_traces (run_id, created_at desc, trace_id desc);

drop index if exists research_run_traces_subject_idx;
create index if not exists research_run_traces_subject_idx
  on research_run_traces (subject_key, created_at desc, trace_id desc);

drop index if exists research_run_traces_outcome_idx;
create index if not exists research_run_traces_outcome_idx
  on research_run_traces (outcome, created_at desc, trace_id desc);
