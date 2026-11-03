-- Digital team, upgrade 8 / stage B2 — standard operating procedures with versions. Additive and idempotent: ONE new table.
--   team_sops   one row per VERSION of a procedure (purpose, trigger, steps, owner role, success measure, escalation, what needs
--               approval, department). A change is a new row; the old row is only CLOSED (status 'superseded' + valid_to) — a stored
--               procedure is never edited or deleted (trigger). A change an employee proposes waits as status 'proposed' for the owner.
--               The built-in default procedures live in code; the first stored version of one replaces it as "current".
-- RLS: members with ai.use read; only the server (service_role) writes. Without it the defaults in code still work, read-only.

create table if not exists public.team_sops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sop_key text not null check (sop_key ~ '^[a-z0-9_]{3,40}$'),
  version int not null check (version >= 1),
  status text not null check (status in ('current', 'proposed', 'superseded', 'rejected')),
  source text not null check (source in ('owner', 'agent')),
  dept_key text not null check (dept_key in ('sales', 'marketing', 'service', 'operations', 'finance', 'management')),
  lang text not null default 'he' check (lang in ('he', 'en', 'ar')),
  title text not null check (char_length(title) between 3 and 120),
  purpose text not null default '' check (char_length(purpose) <= 400),
  trigger_text text not null default '' check (char_length(trigger_text) <= 400),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 12),
  owner_role text not null default 'manager' check (char_length(owner_role) <= 40),
  success_metric text not null default '' check (char_length(success_metric) <= 300),
  escalation text not null default '' check (char_length(escalation) <= 400),
  approvals jsonb not null default '[]'::jsonb check (jsonb_typeof(approvals) = 'array' and jsonb_array_length(approvals) <= 8),
  proposed_by uuid references public.team_members(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint team_sops_version unique (organization_id, sop_key, version)
);
-- at most ONE version in force per procedure
create unique index if not exists team_sops_one_current on public.team_sops (organization_id, sop_key) where status = 'current';
create index if not exists team_sops_org on public.team_sops (organization_id, status, dept_key);

-- stored text is never rewritten; only the lifecycle columns may change, and only forward
create or replace function public.team_sops_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'team_sops: a procedure version is never deleted';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.sop_key is distinct from old.sop_key
     or new.version is distinct from old.version
     or new.source is distinct from old.source
     or new.dept_key is distinct from old.dept_key
     or new.lang is distinct from old.lang
     or new.title is distinct from old.title
     or new.purpose is distinct from old.purpose
     or new.trigger_text is distinct from old.trigger_text
     or new.steps is distinct from old.steps
     or new.owner_role is distinct from old.owner_role
     or new.success_metric is distinct from old.success_metric
     or new.escalation is distinct from old.escalation
     or new.approvals is distinct from old.approvals
     or new.proposed_by is distinct from old.proposed_by
     or new.created_at is distinct from old.created_at then
    raise exception 'team_sops: a stored procedure cannot be edited; save a new version';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'proposed' and new.status in ('current', 'rejected'))
    or (old.status = 'current' and new.status = 'superseded')) then
    raise exception 'team_sops: status cannot go from % to %', old.status, new.status;
  end if;
  return new;
end $$;

drop trigger if exists team_sops_guard on public.team_sops;
create trigger team_sops_guard before update or delete on public.team_sops
  for each row execute function public.team_sops_guard();

alter table public.team_sops enable row level security;
drop policy if exists team_sops_read on public.team_sops;
create policy team_sops_read on public.team_sops for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_sops from anon, authenticated;
grant select on public.team_sops to authenticated;
grant select, insert, update on public.team_sops to service_role;

notify pgrst, 'reload schema';
