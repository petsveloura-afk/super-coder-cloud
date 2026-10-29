-- Wave 54 — agents that act: long-term memory per customer, the AI Operator's history,
-- and two new members of the AI team (review requests, re-engagement).
-- Additive and idempotent: new tables with RLS, the agent CHECK lists are only widened
-- (every existing value stays allowed). Nothing existing is dropped or rewritten.

-- ---------------------------------------------------------------- what the agents remember about each customer
create table if not exists public.contact_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  fact text not null check (char_length(fact) between 2 and 300),
  kind text not null default 'fact' check (kind in ('fact', 'preference', 'need', 'budget', 'objection', 'personal', 'context')),
  source text not null default 'agent' check (source in ('agent', 'lead', 'team', 'operator')),
  conversation_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create unique index if not exists contact_memories_unique on public.contact_memories (organization_id, contact_id, lower(fact));
create index if not exists contact_memories_contact on public.contact_memories (organization_id, contact_id, created_at desc);
alter table public.contact_memories enable row level security;
drop policy if exists contact_memories_read on public.contact_memories;
create policy contact_memories_read on public.contact_memories for select to authenticated
  using (public.has_permission(organization_id, 'contacts.read') or public.has_permission(organization_id, 'inbox.read'));
drop policy if exists contact_memories_insert on public.contact_memories;
create policy contact_memories_insert on public.contact_memories for insert to authenticated
  with check (public.has_permission(organization_id, 'contacts.write'));
drop policy if exists contact_memories_delete on public.contact_memories;
create policy contact_memories_delete on public.contact_memories for delete to authenticated
  using (public.has_permission(organization_id, 'contacts.write'));
grant select, insert, delete on public.contact_memories to authenticated;

-- ---------------------------------------------------------------- AI Operator: every instruction, its plan and what was done
create table if not exists public.operator_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  instruction text not null check (char_length(instruction) between 1 and 2000),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) < 60000),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array' and pg_column_size(results) < 60000),
  status text not null default 'planned' check (status in ('planned', 'executed', 'partial', 'failed')),
  created_at timestamptz not null default now(),
  executed_at timestamptz
);
create index if not exists operator_runs_org on public.operator_runs (organization_id, created_at desc);
alter table public.operator_runs enable row level security;
drop policy if exists operator_runs_read on public.operator_runs;
create policy operator_runs_read on public.operator_runs for select to authenticated
  using (public.is_org_member(organization_id) and (user_id = auth.uid() or public.has_permission(organization_id, 'ai.manage')));
drop policy if exists operator_runs_insert on public.operator_runs;
create policy operator_runs_insert on public.operator_runs for insert to authenticated
  with check (public.has_permission(organization_id, 'ai.use') and user_id = auth.uid());
drop policy if exists operator_runs_update on public.operator_runs;
create policy operator_runs_update on public.operator_runs for update to authenticated
  using (user_id = auth.uid() and public.has_permission(organization_id, 'ai.use'))
  with check (user_id = auth.uid() and public.has_permission(organization_id, 'ai.use'));
grant select, insert, update on public.operator_runs to authenticated;

-- ---------------------------------------------------------------- new AI team members: widen the agent lists
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.agent_settings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%agent%' and pg_get_constraintdef(oid) ilike '%collections%'
  loop
    execute format('alter table public.agent_settings drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint
            where conrelid = 'public.agent_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%agent%' and pg_get_constraintdef(oid) ilike '%collections%'
  loop
    execute format('alter table public.agent_runs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.agent_settings add constraint agent_settings_agent_check
  check (agent in ('marketing', 'sales_manager', 'analyst', 'collections', 'reviews_requester', 'reengage'));
alter table public.agent_runs add constraint agent_runs_agent_check
  check (agent in ('marketing', 'sales_manager', 'analyst', 'collections', 'social', 'reviews', 'stores', 'reviews_requester', 'reengage', 'operator'));

notify pgrst, 'reload schema';
