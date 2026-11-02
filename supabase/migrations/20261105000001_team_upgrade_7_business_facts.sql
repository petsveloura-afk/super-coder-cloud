-- Digital team, upgrade 7 / stage B — versioned business facts. Additive and idempotent: ONE new table, nothing existing is touched.
--
--   team_business_facts   one row per VERSION of a business fact (price, hours, policy, contact, offer…): the value, where it
--                         came from, when it was observed, its validity window, its confidence and whether the owner
--                         confirmed it. History is kept forever: a new value is a new row; the old row is only CLOSED
--                         (status 'superseded' + valid_to). Rows are never deleted, and a value is never edited (trigger).
--                         A value that contradicts an owner-confirmed one waits as status 'proposed' until the owner decides.
--
-- RLS: members with ai.use read their own business's rows; only the server (service_role) writes. Without this migration the
-- team keeps working exactly as before — the facts tools answer "migration_not_applied" and the screen hides the panel.
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_business_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fact_key text not null check (char_length(fact_key) between 2 and 120),
  label text not null check (char_length(label) between 2 and 120),
  kind text not null check (kind in ('price', 'hours', 'policy', 'contact', 'offer', 'other')),
  value text not null check (char_length(value) between 1 and 600),
  unit text check (unit is null or char_length(unit) <= 30),
  source text not null check (source in ('owner', 'crm', 'document', 'agent', 'web')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 600),
  confidence real not null check (confidence between 0 and 1),
  owner_confirmed boolean not null default false,
  status text not null check (status in ('current', 'proposed', 'superseded', 'rejected')),
  version int not null check (version >= 1),
  supersedes uuid references public.team_business_facts(id) on delete set null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  observed_at timestamptz not null,
  recorded_by uuid references public.team_members(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_business_facts_version unique (organization_id, fact_key, version),
  constraint team_business_facts_validity check (valid_to is null or valid_to > valid_from)
);

-- at most ONE value in force per fact
create unique index if not exists team_business_facts_one_current
  on public.team_business_facts (organization_id, fact_key) where status = 'current';
create index if not exists team_business_facts_lookup
  on public.team_business_facts (organization_id, status, kind);
create index if not exists team_business_facts_history
  on public.team_business_facts (organization_id, fact_key, version desc);

-- a stored value is never rewritten: only the lifecycle columns may change
create or replace function public.team_business_facts_guard() returns trigger
language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.fact_key is distinct from old.fact_key
     or new.label is distinct from old.label
     or new.kind is distinct from old.kind
     or new.value is distinct from old.value
     or new.unit is distinct from old.unit
     or new.source is distinct from old.source
     or new.source_ref is distinct from old.source_ref
     or new.version is distinct from old.version
     or new.observed_at is distinct from old.observed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'team_business_facts: a stored value cannot be edited; record a new version';
  end if;
  return new;
end $$;

drop trigger if exists team_business_facts_guard on public.team_business_facts;
create trigger team_business_facts_guard before update on public.team_business_facts
  for each row execute function public.team_business_facts_guard();

alter table public.team_business_facts enable row level security;

drop policy if exists team_business_facts_read on public.team_business_facts;
create policy team_business_facts_read on public.team_business_facts
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));

revoke insert, update, delete on public.team_business_facts from anon, authenticated;
grant select on public.team_business_facts to authenticated;
-- no delete for anybody: the history is permanent
grant select, insert, update on public.team_business_facts to service_role;

notify pgrst, 'reload schema';
