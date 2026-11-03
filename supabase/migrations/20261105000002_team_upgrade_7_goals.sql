-- Digital team, upgrade 7 / stage C — business goals and honest forecasts. Additive and idempotent: two NEW tables, nothing existing is touched.
--
--   team_business_goals      a goal = metric + baseline + target + due date + owner. `status` 'proposed' when an employee suggested it
--                            (the owner activates it); `last_risk` remembers the last forecast so ONE alert is raised per change.
--   team_goal_snapshots      one row per goal per day: the measured value and the forecast range (append-only history, upserted per day).
--
-- RLS: members with ai.use read their own business's rows; only the server (service_role) writes. Without this migration the team
-- works exactly as before — the goals tools answer "migration_not_applied" and the card is hidden.
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_business_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  metric text not null check (metric in ('leads_new', 'deals_won', 'revenue_won', 'conversations', 'reviews_avg', 'reply_minutes', 'custom')),
  baseline numeric(16, 2) not null default 0,
  target numeric(16, 2) not null,
  start_date date not null,
  due_date date not null,
  owner_member_id uuid references public.team_members(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'achieved', 'missed', 'paused')),
  source text not null default 'owner' check (source in ('owner', 'agent')),
  last_risk text check (last_risk is null or last_risk in ('achieved', 'on_track', 'at_risk', 'off_track', 'not_enough_data', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_business_goals_dates check (due_date > start_date)
);
create index if not exists team_business_goals_org on public.team_business_goals (organization_id, status, due_date);

create table if not exists public.team_goal_snapshots (
  goal_id uuid not null references public.team_business_goals(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  value numeric(16, 2) not null,
  expected numeric(16, 2),
  low numeric(16, 2),
  high numeric(16, 2),
  probability real check (probability is null or probability between 0 and 1),
  risk text not null,
  created_at timestamptz not null default now(),
  primary key (goal_id, day)
);
create index if not exists team_goal_snapshots_org on public.team_goal_snapshots (organization_id, day desc);

alter table public.team_business_goals enable row level security;
alter table public.team_goal_snapshots enable row level security;

drop policy if exists team_business_goals_read on public.team_business_goals;
create policy team_business_goals_read on public.team_business_goals
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_goal_snapshots_read on public.team_goal_snapshots;
create policy team_goal_snapshots_read on public.team_goal_snapshots
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));

revoke insert, update, delete on public.team_business_goals from anon, authenticated;
revoke insert, update, delete on public.team_goal_snapshots from anon, authenticated;
grant select on public.team_business_goals, public.team_goal_snapshots to authenticated;
grant select, insert, update on public.team_business_goals, public.team_goal_snapshots to service_role;

notify pgrst, 'reload schema';
