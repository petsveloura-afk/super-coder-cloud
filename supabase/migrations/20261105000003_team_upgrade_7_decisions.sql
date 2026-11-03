-- Digital team, upgrade 7 / stages E + J — the decision record and the owner's feedback. Additive and idempotent: two NEW tables.
--
--   team_decisions          one row per decision record: what was understood, decided, why, the options and pre-mortem (jsonb), the
--                           raw and the calibrated confidence, the audit verdict, and a hash chain (prev_hash / hash) per task.
--                           APPEND-ONLY: a trigger rejects every update and delete (only the cascade of deleting the whole business passes).
--   team_decision_feedback  what the owner says about a decision afterwards: the outcome (good / bad) and, when needed, the correction.
--                           Also append-only. Calibration is computed from these rows; the lesson itself goes to team_memory as a PROPOSAL.
--
-- RLS: members with ai.use read their own business's rows; only the server (service_role) writes. Without this migration the team
-- works exactly as before — decisions are simply not stored and the "why I did this" panel is hidden.
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- plain ids (no foreign keys): the record outlives the tasks / employees it describes
  task_id uuid not null,
  member_id uuid,
  seq int not null check (seq >= 1),
  route text not null check (route in ('fast', 'deep')),
  route_reasons jsonb not null default '[]'::jsonb,
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) < 30000),
  confidence real not null check (confidence between 0 and 1),
  raw_confidence real not null check (raw_confidence between 0 and 1),
  audit_verdict text check (audit_verdict is null or audit_verdict in ('approve', 'revise', 'escalate')),
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  constraint team_decisions_chain unique (organization_id, task_id, seq)
);
create index if not exists team_decisions_org on public.team_decisions (organization_id, created_at desc);
create index if not exists team_decisions_task on public.team_decisions (organization_id, task_id, seq);

create table if not exists public.team_decision_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_id uuid not null references public.team_decisions(id) on delete cascade,
  kind text not null check (kind in ('outcome', 'correction')),
  result text not null check (result in ('good', 'bad')),
  note text check (note is null or char_length(note) <= 1000),
  correction text check (correction is null or char_length(correction) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists team_decision_feedback_org on public.team_decision_feedback (organization_id, created_at desc);
create index if not exists team_decision_feedback_decision on public.team_decision_feedback (decision_id);

create or replace function public.team_decisions_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- the only delete allowed is the cascade when the whole business is deleted (fired from the FK, depth > 1)
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists team_decisions_no_change on public.team_decisions;
create trigger team_decisions_no_change before update or delete on public.team_decisions
  for each row execute function public.team_decisions_immutable();
drop trigger if exists team_decision_feedback_no_change on public.team_decision_feedback;
create trigger team_decision_feedback_no_change before update or delete on public.team_decision_feedback
  for each row execute function public.team_decisions_immutable();

alter table public.team_decisions enable row level security;
alter table public.team_decision_feedback enable row level security;

drop policy if exists team_decisions_read on public.team_decisions;
create policy team_decisions_read on public.team_decisions
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_decision_feedback_read on public.team_decision_feedback;
create policy team_decision_feedback_read on public.team_decision_feedback
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));

revoke insert, update, delete on public.team_decisions from anon, authenticated;
revoke insert, update, delete on public.team_decision_feedback from anon, authenticated;
grant select on public.team_decisions, public.team_decision_feedback to authenticated;
grant select, insert on public.team_decisions, public.team_decision_feedback to service_role;

notify pgrst, 'reload schema';
