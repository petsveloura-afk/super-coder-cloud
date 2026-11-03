-- Digital team, upgrade 8 / stage B1 — departments. Additive and idempotent (safe to run twice): TWO new tables, nothing existing is touched.
--   team_departments   one row per business and department (sales, marketing, service, operations, finance, management): the head
--                      (an existing employee) and the daily credit budget. The names in three languages live in code.
--   team_dept_members  which department an employee belongs to; manual = true means the owner placed the person by hand and the
--                      automatic role mapping never overwrites it.
-- RLS: members with ai.use read; only the server (service_role) writes. Without it the team works exactly as before.

create table if not exists public.team_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dept_key text not null check (dept_key in ('sales', 'marketing', 'service', 'operations', 'finance', 'management')),
  head_member_id uuid references public.team_members(id) on delete set null,
  credit_budget int not null default 0 check (credit_budget between 0 and 1000000),
  updated_at timestamptz not null default now(),
  constraint team_departments_unique unique (organization_id, dept_key)
);
create index if not exists team_departments_org on public.team_departments (organization_id);

create table if not exists public.team_dept_members (
  member_id uuid primary key references public.team_members(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dept_key text not null check (dept_key in ('sales', 'marketing', 'service', 'operations', 'finance', 'management')),
  manual boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists team_dept_members_org on public.team_dept_members (organization_id, dept_key);

alter table public.team_departments enable row level security;
alter table public.team_dept_members enable row level security;
drop policy if exists team_departments_read on public.team_departments;
create policy team_departments_read on public.team_departments for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_dept_members_read on public.team_dept_members;
create policy team_dept_members_read on public.team_dept_members for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_departments, public.team_dept_members from anon, authenticated;
grant select on public.team_departments, public.team_dept_members to authenticated;
grant select, insert, update on public.team_departments, public.team_dept_members to service_role;

notify pgrst, 'reload schema';
