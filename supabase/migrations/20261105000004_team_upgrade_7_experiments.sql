-- Digital team, upgrade 7 / stage F — recommendations and A/B experiments. Additive and idempotent: ONE new table.
--   team_experiments   an experiment: hypothesis, ONE deciding metric, owner, the two variants with their counts (trials / successes),
--                      baseline, minimum effect and minimum days. 'proposed' when an employee suggested it (the owner starts it).
--                      The verdict is computed in code only after the planned sample size; "not enough data" is a normal state.
-- RLS: members with ai.use read; only the server (service_role) writes. Without it the experiments tools answer "migration_not_applied".
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 140),
  hypothesis text not null check (char_length(hypothesis) between 5 and 400),
  metric text not null check (char_length(metric) between 1 and 60),
  owner_member_id uuid references public.team_members(id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'running', 'concluded', 'stopped')),
  source text not null default 'agent' check (source in ('owner', 'agent')),
  baseline_rate real check (baseline_rate is null or (baseline_rate > 0 and baseline_rate < 1)),
  min_effect real not null default 0.2 check (min_effect between 0.05 and 2),
  min_days int not null default 7 check (min_days between 1 and 90),
  a_name text not null check (char_length(a_name) between 1 and 160),
  b_name text not null check (char_length(b_name) between 1 and 160),
  a_trials int not null default 0 check (a_trials >= 0),
  a_successes int not null default 0 check (a_successes >= 0 and a_successes <= a_trials),
  b_trials int not null default 0 check (b_trials >= 0),
  b_successes int not null default 0 check (b_successes >= 0 and b_successes <= b_trials),
  started_at timestamptz,
  concluded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_experiments_org on public.team_experiments (organization_id, status, created_at desc);

alter table public.team_experiments enable row level security;
drop policy if exists team_experiments_read on public.team_experiments;
create policy team_experiments_read on public.team_experiments
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_experiments from anon, authenticated;
grant select on public.team_experiments to authenticated;
grant select, insert, update on public.team_experiments to service_role;

notify pgrst, 'reload schema';
