-- Digital team, upgrade 8 / stage B5 — job descriptions. Additive and idempotent: ONE new table, nothing existing is touched.
--   team_job_profiles   the owner's own wording of one employee's job description (responsibilities, authority, extra prohibitions) on top of
--                       the role's default in code. An empty array = "use the default". The text grants nothing: tools and approval rules
--                       are unchanged. The universal prohibitions live in code and cannot be removed from here.
-- B6 (department meetings, the weekly split) needs no table: it is built in code from the existing tasks.
-- RLS: members with ai.use read; only the server (service_role) writes. Without this table the team works exactly as before.

create table if not exists public.team_job_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.team_members(id) on delete cascade,
  responsibilities text[] not null default '{}' check (cardinality(responsibilities) <= 8),
  authority text[] not null default '{}' check (cardinality(authority) <= 8),
  forbidden_extra text[] not null default '{}' check (cardinality(forbidden_extra) <= 8),
  lang text check (lang is null or lang in ('he', 'en', 'ar')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint team_job_profiles_unique unique (organization_id, member_id)
);
create index if not exists team_job_profiles_org on public.team_job_profiles (organization_id);

alter table public.team_job_profiles enable row level security;
drop policy if exists team_job_profiles_read on public.team_job_profiles;
create policy team_job_profiles_read on public.team_job_profiles for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_job_profiles from anon, authenticated;
grant select on public.team_job_profiles to authenticated;
grant select, insert, update on public.team_job_profiles to service_role;

notify pgrst, 'reload schema';
