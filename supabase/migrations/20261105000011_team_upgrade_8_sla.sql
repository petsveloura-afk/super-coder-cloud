-- Digital team, upgrade 8 / stage B4 — service agreements between departments (SLA). Additive and idempotent: TWO new tables.
--   team_dept_sla      the owner's override of one agreement (minutes / on-off) on top of the defaults in code.
--   team_sla_alerts    one row per business, agreement and day on which the owner was alerted: the unique key keeps the alert to ONE a day.
-- The measurement itself reads data that already exists (handoff messages and tasks); nothing is copied here.
-- RLS: members with ai.use read; only the server (service_role) writes. Without these tables the team works exactly as before.

create table if not exists public.team_dept_sla (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sla_id text not null check (sla_id in ('marketing_sales', 'marketing_service', 'sales_finance', 'sales_service', 'service_operations', 'service_sales')),
  minutes int check (minutes is null or (minutes between 5 and 10080)),
  enabled boolean,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint team_dept_sla_unique unique (organization_id, sla_id)
);
create index if not exists team_dept_sla_org on public.team_dept_sla (organization_id);

create table if not exists public.team_sla_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_key text not null,
  line text not null default '',
  created_at timestamptz not null default now(),
  constraint team_sla_alerts_unique unique (organization_id, alert_key)
);
create index if not exists team_sla_alerts_org on public.team_sla_alerts (organization_id, created_at desc);

alter table public.team_dept_sla enable row level security;
alter table public.team_sla_alerts enable row level security;
drop policy if exists team_dept_sla_read on public.team_dept_sla;
create policy team_dept_sla_read on public.team_dept_sla for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_sla_alerts_read on public.team_sla_alerts;
create policy team_sla_alerts_read on public.team_sla_alerts for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_dept_sla, public.team_sla_alerts from anon, authenticated;
grant select on public.team_dept_sla, public.team_sla_alerts to authenticated;
grant select, insert, update on public.team_dept_sla, public.team_sla_alerts to service_role;

notify pgrst, 'reload schema';
