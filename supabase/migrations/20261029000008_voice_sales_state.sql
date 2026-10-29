-- Wave 55 — voice persona per agent and a persisted sales funnel state per conversation.
-- Additive and idempotent: new nullable/defaulted columns, one new table with RLS and one
-- RPC. Nothing existing is dropped or rewritten.

-- ---------------------------------------------------------------- voice persona (ElevenLabs / OpenAI) per AI agent
alter table public.ai_agents add column if not exists voice jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_agents_voice_object') then
    alter table public.ai_agents add constraint ai_agents_voice_object
      check (jsonb_typeof(voice) = 'object' and pg_column_size(voice) < 8000);
  end if;
end $$;

-- ---------------------------------------------------------------- sales funnel state per conversation
alter table public.conversations add column if not exists sales_state text;
alter table public.conversations add column if not exists sales_state_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_sales_state_check') then
    alter table public.conversations add constraint conversations_sales_state_check
      check (sales_state is null or sales_state in ('NEW_LEAD', 'QUALIFYING_NEEDS', 'VALUE_PROP', 'OBJECTION_HANDLING', 'DEMO_OR_OFFER', 'CLOSING', 'BOOKED_MEETING', 'HUMAN_HANDOFF'));
  end if;
end $$;
create index if not exists conversations_sales_state on public.conversations (organization_id, sales_state) where sales_state is not null;

create table if not exists public.conversation_state_events (
  id bigserial primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  from_state text,
  to_state text not null check (to_state in ('NEW_LEAD', 'QUALIFYING_NEEDS', 'VALUE_PROP', 'OBJECTION_HANDLING', 'DEMO_OR_OFFER', 'CLOSING', 'BOOKED_MEETING', 'HUMAN_HANDOFF')),
  reason text check (reason is null or char_length(reason) <= 200),
  source text not null default 'agent' check (source in ('agent', 'team')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists conversation_state_events_conv on public.conversation_state_events (conversation_id, created_at desc);
create index if not exists conversation_state_events_org on public.conversation_state_events (organization_id, created_at desc);
alter table public.conversation_state_events enable row level security;
drop policy if exists conversation_state_events_read on public.conversation_state_events;
create policy conversation_state_events_read on public.conversation_state_events for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
grant select on public.conversation_state_events to authenticated;

-- The team moves a conversation to another funnel state by hand (logged as an event).
create or replace function public.set_sales_state(p_conv uuid, p_state text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from text;
begin
  if p_state not in ('NEW_LEAD', 'QUALIFYING_NEEDS', 'VALUE_PROP', 'OBJECTION_HANDLING', 'DEMO_OR_OFFER', 'CLOSING', 'BOOKED_MEETING', 'HUMAN_HANDOFF') then
    return jsonb_build_object('ok', false, 'error', 'sales.invalidState');
  end if;
  select organization_id, sales_state into v_org, v_from from public.conversations where id = p_conv;
  if v_org is null or not public.has_permission(v_org, 'inbox.reply') then
    return jsonb_build_object('ok', false, 'error', 'errors.forbidden');
  end if;
  if v_from is not distinct from p_state then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.conversations set sales_state = p_state, sales_state_at = now() where id = p_conv;
  insert into public.conversation_state_events (organization_id, conversation_id, from_state, to_state, reason, source, created_by)
  values (v_org, p_conv, v_from, p_state, left(coalesce(p_reason, 'manual'), 200), 'team', auth.uid());
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.set_sales_state(uuid, text, text) from public;
grant execute on function public.set_sales_state(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- paid features, like the market (+ a free trial per feature)
-- New plan features (only ADDED to the plans that include them; nothing is removed from any plan):
--   voice_notes    the agent answers voice notes with a voice note + its own voice persona   (Pro and up)
--   ai_operator    the AI Operator (instructions → executed actions)                         (Pro and up)
--   ai_team        the AI team: marketing, sales manager, analyst, collections               (Pro and up)
--   ai_team_plus   the new team members: review requester, customer re-engager               (Business and up)
update public.plans set features = array_append(features, 'voice_notes')
 where key in ('pro', 'business', 'enterprise') and not ('voice_notes' = any (features));
update public.plans set features = array_append(features, 'ai_operator')
 where key in ('pro', 'business', 'enterprise') and not ('ai_operator' = any (features));
update public.plans set features = array_append(features, 'ai_team')
 where key in ('pro', 'business', 'enterprise') and not ('ai_team' = any (features));
update public.plans set features = array_append(features, 'ai_team_plus')
 where key in ('business', 'enterprise') and not ('ai_team_plus' = any (features));

-- one free trial per feature per business (7 days), started by an admin of the business
create table if not exists public.feature_trials (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature text not null check (feature in ('voice_notes', 'ai_operator', 'ai_team', 'ai_team_plus', 'advanced_analytics', 'flow_builder', 'ai_insights')),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  started_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, feature)
);
alter table public.feature_trials enable row level security;
drop policy if exists feature_trials_read on public.feature_trials;
create policy feature_trials_read on public.feature_trials for select to authenticated
  using (public.is_org_member(organization_id));
grant select on public.feature_trials to authenticated;

-- a feature is available from the plan OR from an active trial
create or replace function public.has_feature(p_org uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select p_feature = any (p.features) from public.organizations o join public.plans p on p.key = o.plan where o.id = p_org), false)
      or exists (select 1 from public.feature_trials t where t.organization_id = p_org and t.feature = p_feature and t.ends_at > now());
$$;
revoke all on function public.has_feature(uuid, text) from public, anon;
grant execute on function public.has_feature(uuid, text) to authenticated, service_role;

-- what the screen needs: allowed? from the plan or a trial? trial still available? when does it end?
create or replace function public.feature_access(p_org uuid, p_feature text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan boolean;
  v_trial public.feature_trials;
begin
  if not public.is_org_member(p_org) and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') <> 'service_role' then
    return jsonb_build_object('allowed', false, 'via', null, 'trial_available', false, 'trial_ends_at', null);
  end if;
  select coalesce((select p_feature = any (p.features) from public.organizations o join public.plans p on p.key = o.plan where o.id = p_org), false) into v_plan;
  select * into v_trial from public.feature_trials where organization_id = p_org and feature = p_feature;
  return jsonb_build_object(
    'allowed', v_plan or (v_trial.ends_at is not null and v_trial.ends_at > now()),
    'via', case when v_plan then 'plan' when v_trial.ends_at > now() then 'trial' else null end,
    'trial_available', not v_plan and v_trial.organization_id is null
      and p_feature in ('voice_notes', 'ai_operator', 'ai_team', 'ai_team_plus', 'advanced_analytics', 'flow_builder', 'ai_insights'),
    'trial_ends_at', v_trial.ends_at
  );
end $$;
revoke all on function public.feature_access(uuid, text) from public, anon;
grant execute on function public.feature_access(uuid, text) to authenticated, service_role;

create or replace function public.start_feature_trial(p_org uuid, p_feature text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ends timestamptz := now() + interval '7 days';
begin
  if p_feature not in ('voice_notes', 'ai_operator', 'ai_team', 'ai_team_plus', 'advanced_analytics', 'flow_builder', 'ai_insights') then
    return jsonb_build_object('ok', false, 'error', 'trial.notAvailable');
  end if;
  if not (public.has_permission(p_org, 'billing.manage') or public.has_permission(p_org, 'ai.manage')) then
    return jsonb_build_object('ok', false, 'error', 'errors.forbidden');
  end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.is_demo) then
    return jsonb_build_object('ok', false, 'error', 'trial.demo');
  end if;
  if coalesce((select p_feature = any (p.features) from public.organizations o join public.plans p on p.key = o.plan where o.id = p_org), false) then
    return jsonb_build_object('ok', false, 'error', 'trial.inPlan');
  end if;
  if exists (select 1 from public.feature_trials where organization_id = p_org and feature = p_feature) then
    return jsonb_build_object('ok', false, 'error', 'trial.used');
  end if;
  insert into public.feature_trials (organization_id, feature, ends_at, started_by) values (p_org, p_feature, v_ends, auth.uid());
  return jsonb_build_object('ok', true, 'ends_at', v_ends);
end $$;
revoke all on function public.start_feature_trial(uuid, text) from public, anon;
grant execute on function public.start_feature_trial(uuid, text) to authenticated;

notify pgrst, 'reload schema';
