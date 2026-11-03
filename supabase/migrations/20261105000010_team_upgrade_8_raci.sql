-- Digital team, upgrade 8 / stage B3 — responsibility (RACI) and the approval matrix. Additive and idempotent: TWO new tables, nothing
-- existing is touched. The defaults live in code; these rows are only the OWNER'S changes on top of them.
--   team_raci_roles    one row per business and procedure key: the owner's override of who does it (R), approves (A), is consulted (C) and informed (I).
--   team_raci_matrix   one row per business and matrix rule: the owner's switch and threshold for an EXTRA approval rule.
-- Both can only add approvals: the code never lets either of them lower an existing protection (see lib/team/raci-core.ts).
-- RLS: members with ai.use read; only the server (service_role) writes. Without these tables the team works exactly as before.

create table if not exists public.team_raci_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sop_key text not null check (char_length(sop_key) between 3 and 40),
  r_role text,
  a_role text,
  c_roles text[] not null default '{}',
  i_roles text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint team_raci_roles_unique unique (organization_id, sop_key)
);
create index if not exists team_raci_roles_org on public.team_raci_roles (organization_id);

create table if not exists public.team_raci_matrix (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null check (rule_id in ('discount_pct', 'discount_amount', 'deal_value', 'broadcast', 'bulk_agents')),
  enabled boolean,
  threshold numeric check (threshold is null or (threshold >= 0 and threshold <= 1000000000)),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint team_raci_matrix_unique unique (organization_id, rule_id)
);
create index if not exists team_raci_matrix_org on public.team_raci_matrix (organization_id);

alter table public.team_raci_roles enable row level security;
alter table public.team_raci_matrix enable row level security;
drop policy if exists team_raci_roles_read on public.team_raci_roles;
create policy team_raci_roles_read on public.team_raci_roles for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_raci_matrix_read on public.team_raci_matrix;
create policy team_raci_matrix_read on public.team_raci_matrix for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_raci_roles, public.team_raci_matrix from anon, authenticated;
grant select on public.team_raci_roles, public.team_raci_matrix to authenticated;
grant select, insert, update on public.team_raci_roles, public.team_raci_matrix to service_role;

notify pgrst, 'reload schema';
