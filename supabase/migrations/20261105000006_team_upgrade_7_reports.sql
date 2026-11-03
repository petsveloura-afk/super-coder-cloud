-- Digital team, upgrade 7 / stage H — stored reports. Additive and idempotent: ONE new table.
--   team_reports   one row per generated weekly / monthly report or morning brief (the structured sections + the text), unique per
--                  business, kind and period start, so a repeated run never duplicates.
-- RLS: members with analytics.read read; only the server (service_role) writes. Without it reports are built on the fly and not stored.
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('week', 'month', 'brief')),
  period_start date not null,
  title text not null check (char_length(title) between 2 and 200),
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) < 60000),
  text text not null check (char_length(text) <= 20000),
  created_at timestamptz not null default now(),
  constraint team_reports_unique unique (organization_id, kind, period_start)
);
create index if not exists team_reports_org on public.team_reports (organization_id, kind, period_start desc);

alter table public.team_reports enable row level security;
drop policy if exists team_reports_read on public.team_reports;
create policy team_reports_read on public.team_reports
  for select to authenticated using (public.has_permission(organization_id, 'analytics.read'));
revoke insert, update, delete on public.team_reports from anon, authenticated;
grant select on public.team_reports to authenticated;
grant select, insert, update on public.team_reports to service_role;

notify pgrst, 'reload schema';
