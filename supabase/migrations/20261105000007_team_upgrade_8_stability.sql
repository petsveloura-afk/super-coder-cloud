-- Digital team, upgrade 8 / stage A — stability. Additive and idempotent (safe to run twice):
--   * team_tasks.status CHECK is widened: 'requires_connection' (a task that only needs a connection is NOT a failure) and
--     'merged' (a duplicate that was merged into another task — nothing is deleted).
--   * new nullable columns on team_tasks: merged_into, fingerprint, failure_kind, restarts, recipient_key.
--   * team_business_goals: status 'merged' + merged_into (duplicate goals are marked, not deleted).
--   * team_provider_usage: per AI provider per day — calls, failures, rest-until, last error (service role writes; platform admins read).
-- Nothing existing is dropped or rewritten except replacing the two status CHECK constraints by wider ones (every old value stays valid).

-- ---------------------------------------------------------------------------------------------- team_tasks: wider status CHECK
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.team_tasks'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%awaiting_approval%'
      and conname <> 'team_tasks_status_check_v8'
  loop
    execute format('alter table public.team_tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.team_tasks drop constraint if exists team_tasks_status_check_v8;
alter table public.team_tasks add constraint team_tasks_status_check_v8
  check (status in ('draft', 'pending', 'in_progress', 'awaiting_approval', 'awaiting_input', 'blocked', 'done', 'failed', 'canceled', 'requires_connection', 'merged'));

alter table public.team_tasks add column if not exists merged_into uuid references public.team_tasks(id) on delete set null;
alter table public.team_tasks add column if not exists fingerprint text check (fingerprint is null or char_length(fingerprint) <= 40);
alter table public.team_tasks add column if not exists failure_kind text check (failure_kind is null or failure_kind in ('missing_connection', 'missing_data', 'temporary', 'bad_input', 'bug'));
alter table public.team_tasks add column if not exists restarts int not null default 0 check (restarts >= 0 and restarts <= 100);
alter table public.team_tasks add column if not exists recipient_key text check (recipient_key is null or char_length(recipient_key) <= 120);
create index if not exists team_tasks_fingerprint on public.team_tasks (organization_id, fingerprint) where fingerprint is not null;

-- ---------------------------------------------------------------------------------------------- goals: 'merged'
do $$
declare c record;
begin
  if to_regclass('public.team_business_goals') is null then return; end if;
  for c in
    select conname from pg_constraint
    where conrelid = 'public.team_business_goals'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%proposed%'
      and conname <> 'team_business_goals_status_check_v8'
  loop
    execute format('alter table public.team_business_goals drop constraint %I', c.conname);
  end loop;
  alter table public.team_business_goals drop constraint if exists team_business_goals_status_check_v8;
  alter table public.team_business_goals add constraint team_business_goals_status_check_v8
    check (status in ('proposed', 'active', 'achieved', 'missed', 'paused', 'merged'));
  alter table public.team_business_goals add column if not exists merged_into uuid references public.team_business_goals(id) on delete set null;
end $$;

-- ---------------------------------------------------------------------------------------------- AI provider usage (platform-wide)
create table if not exists public.team_provider_usage (
  provider text not null check (provider ~ '^[a-z]{2,20}$'),
  day date not null default current_date,
  calls int not null default 0 check (calls >= 0),
  failures int not null default 0 check (failures >= 0),
  rest_until timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  updated_at timestamptz not null default now(),
  primary key (provider, day)
);
alter table public.team_provider_usage enable row level security;
drop policy if exists team_provider_usage_read on public.team_provider_usage;
create policy team_provider_usage_read on public.team_provider_usage for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete on public.team_provider_usage from anon, authenticated;
grant select on public.team_provider_usage to authenticated;
grant select, insert, update on public.team_provider_usage to service_role;
