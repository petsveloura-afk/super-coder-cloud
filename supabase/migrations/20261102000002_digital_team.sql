-- The digital team: AI employees with roles, playbooks, three-layer memory, an orchestrated task board,
-- structured messages between employees, one approval queue and an append-only activity log.
--
--   team_settings      one row per business: on/off, EMERGENCY STOP, model preference, credit cap, depth / step limits
--   team_members       the employees (role, name, avatar, tone, own instructions, tools, autonomy, reports_to, limits)
--   team_tasks         the shared task board (owner, status, priority, due date, dependencies, depth, cost)
--   team_messages      structured messages between employees (request / answer / clarify / handoff / report / review)
--   team_activity      what each employee understood, planned, did, checked and learned — APPEND-ONLY (no update / delete)
--   team_approvals     everything waiting for the person (with the employee's reasoning); decisions are kept
--   team_memory        episodic + semantic memory per employee (or shared), with confidence, expiry and supersedes
--   team_playbooks     the business's own additions on top of each role's playbook
--   ai_routing         platform model routing: task kind → models by priority (changeable without a deploy)
--
-- Everything is additive and idempotent (new tables only, RLS on). Writes happen on the server (service role) after
-- the permission checks of the app; members read their own business only. The feature is off until the flag
-- `team_v1` is on for the business (feature_flags) AND the business turns the team on — nothing existing changes.

-- --------------------------------------------------------------------------------------------- settings
create table if not exists public.team_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  emergency_stop boolean not null default false,
  routing_pref text not null default 'balanced' check (routing_pref in ('quality', 'balanced', 'speed', 'cost')),
  daily_credit_cap int not null default 200 check (daily_credit_cap between 0 and 100000),
  max_depth int not null default 3 check (max_depth between 1 and 6),
  max_steps int not null default 12 check (max_steps between 1 and 60),
  initiative boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------------------------- employees
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null check (role_key ~ '^[a-z_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  title text check (title is null or char_length(title) <= 120),
  avatar jsonb not null default '{}'::jsonb check (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) < 4000),
  tone text check (tone is null or char_length(tone) <= 400),
  instructions text not null default '' check (char_length(instructions) <= 6000),
  tools text[] not null default '{}' check (cardinality(tools) <= 40),
  autonomy text not null default 'approve' check (autonomy in ('suggest', 'approve', 'auto')),
  auto_actions text[] not null default '{}' check (cardinality(auto_actions) <= 40),
  reports_to uuid references public.team_members(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused')),
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object' and pg_column_size(limits) < 4000),
  linked jsonb not null default '{}'::jsonb check (jsonb_typeof(linked) = 'object' and pg_column_size(linked) < 4000),
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists team_members_org on public.team_members (organization_id, position);

-- --------------------------------------------------------------------------------------------- task board
create table if not exists public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.team_tasks(id) on delete cascade,
  goal_id uuid references public.team_tasks(id) on delete cascade,
  plan_key text check (plan_key is null or plan_key ~ '^[a-z0-9_-]{1,40}$'),
  title text not null check (char_length(title) between 1 and 300),
  brief text not null default '' check (char_length(brief) <= 6000),
  assignee_id uuid references public.team_members(id) on delete set null,
  status text not null default 'pending' check (status in ('draft', 'pending', 'in_progress', 'awaiting_approval', 'awaiting_input', 'blocked', 'done', 'failed', 'canceled')),
  priority int not null default 2 check (priority between 1 and 4),
  due_at timestamptz,
  depends_on uuid[] not null default '{}' check (cardinality(depends_on) <= 20),
  depth int not null default 0 check (depth between 0 and 10),
  steps_used int not null default 0,
  credits_used int not null default 0,
  review_rounds int not null default 0,
  origin text not null default 'user' check (origin in ('user', 'goal', 'handoff', 'initiative', 'schedule')),
  question text check (question is null or char_length(question) <= 1000),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) < 60000),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object' and pg_column_size(result) < 60000),
  error text check (error is null or char_length(error) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (organization_id, id)
);
create index if not exists team_tasks_board on public.team_tasks (organization_id, status, priority, created_at);
create index if not exists team_tasks_goal on public.team_tasks (goal_id);
create index if not exists team_tasks_assignee on public.team_tasks (assignee_id, status);

-- --------------------------------------------------------------------------------------------- messages between employees
create table if not exists public.team_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.team_tasks(id) on delete cascade,
  from_member uuid references public.team_members(id) on delete set null,
  to_member uuid references public.team_members(id) on delete set null,
  kind text not null check (kind in ('request', 'answer', 'clarify', 'handoff', 'report', 'review')),
  body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object' and pg_column_size(body) < 30000),
  created_at timestamptz not null default now()
);
create index if not exists team_messages_task on public.team_messages (task_id, id);

-- --------------------------------------------------------------------------------------------- activity log (append-only)
create table if not exists public.team_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- plain ids (no foreign keys): the log outlives the tasks / employees it describes and is never rewritten
  task_id uuid,
  member_id uuid,
  actor_user uuid,
  phase text not null check (phase in ('understand', 'context', 'plan', 'execute', 'self_check', 'peer_review', 'deliver', 'learn', 'initiative', 'approval', 'system')),
  summary text not null check (char_length(summary) between 1 and 1000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 30000),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists team_activity_org on public.team_activity (organization_id, id desc);
create index if not exists team_activity_task on public.team_activity (task_id, id);

create or replace function public.team_activity_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- the only delete allowed is the cascade when the whole business is deleted (fired from the FK, depth > 1)
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'team_activity is append-only';
end;
$$;
drop trigger if exists team_activity_no_update on public.team_activity;
create trigger team_activity_no_update before update or delete on public.team_activity
  for each row execute function public.team_activity_immutable();

-- --------------------------------------------------------------------------------------------- approvals
create table if not exists public.team_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid references public.team_tasks(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  tool text not null check (tool ~ '^[a-z_]+\.[a-z_]+$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 30000),
  preview text not null default '' check (char_length(preview) <= 4000),
  reason text not null default '' check (char_length(reason) <= 2000),
  sensitivity text not null default 'customer' check (sensitivity in ('internal', 'customer', 'irreversible', 'money')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'edited', 'rejected', 'executed', 'failed', 'expired')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  edited_payload jsonb check (edited_payload is null or (jsonb_typeof(edited_payload) = 'object' and pg_column_size(edited_payload) < 30000)),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object' and pg_column_size(result) < 30000),
  created_at timestamptz not null default now()
);
create index if not exists team_approvals_queue on public.team_approvals (organization_id, status, created_at);

-- --------------------------------------------------------------------------------------------- memory
create table if not exists public.team_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete cascade,
  layer text not null check (layer in ('episodic', 'semantic')),
  kind text not null check (kind in ('fact', 'preference', 'forbidden', 'approved_style', 'rejected', 'correction', 'outcome', 'policy')),
  subject text check (subject is null or char_length(subject) <= 120),
  content text not null check (char_length(content) between 2 and 2000),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  confidence real not null default 0.7 check (confidence between 0 and 1),
  source text not null default 'agent' check (source in ('feedback', 'user', 'agent', 'system')),
  status text not null default 'active' check (status in ('active', 'proposed', 'revoked', 'expired')),
  expires_at timestamptz,
  supersedes uuid references public.team_memory(id) on delete set null,
  uses int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_memory_lookup on public.team_memory (organization_id, member_id, status, layer);
create index if not exists team_memory_subject on public.team_memory (organization_id, subject) where subject is not null;

-- --------------------------------------------------------------------------------------------- playbook additions
create table if not exists public.team_playbooks (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null check (role_key ~ '^[a-z_]{2,40}$'),
  extra text not null default '' check (char_length(extra) <= 6000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, role_key)
);

-- --------------------------------------------------------------------------------------------- model routing (platform)
create table if not exists public.ai_routing (
  task_kind text primary key check (task_kind ~ '^[a-z_]{2,30}$'),
  models jsonb not null default '[]'::jsonb check (jsonb_typeof(models) = 'array' and pg_column_size(models) < 8000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------------------------- RLS
alter table public.team_settings enable row level security;
alter table public.team_members enable row level security;
alter table public.team_tasks enable row level security;
alter table public.team_messages enable row level security;
alter table public.team_activity enable row level security;
alter table public.team_approvals enable row level security;
alter table public.team_memory enable row level security;
alter table public.team_playbooks enable row level security;
alter table public.ai_routing enable row level security;

drop policy if exists team_settings_read on public.team_settings;
create policy team_settings_read on public.team_settings for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_tasks_read on public.team_tasks;
create policy team_tasks_read on public.team_tasks for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_messages_read on public.team_messages;
create policy team_messages_read on public.team_messages for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_activity_read on public.team_activity;
create policy team_activity_read on public.team_activity for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_approvals_read on public.team_approvals;
create policy team_approvals_read on public.team_approvals for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_memory_read on public.team_memory;
create policy team_memory_read on public.team_memory for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists team_playbooks_read on public.team_playbooks;
create policy team_playbooks_read on public.team_playbooks for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists ai_routing_read on public.ai_routing;
create policy ai_routing_read on public.ai_routing for select to authenticated using (public.is_platform_admin());

revoke insert, update, delete on public.team_settings, public.team_members, public.team_tasks, public.team_messages, public.team_activity, public.team_approvals, public.team_memory, public.team_playbooks, public.ai_routing from anon, authenticated;
grant select on public.team_settings, public.team_members, public.team_tasks, public.team_messages, public.team_activity, public.team_approvals, public.team_memory, public.team_playbooks, public.ai_routing to authenticated;
grant select, insert, update, delete on public.team_settings, public.team_members, public.team_tasks, public.team_messages, public.team_approvals, public.team_memory, public.team_playbooks, public.ai_routing to service_role;
grant select, insert on public.team_activity to service_role;

notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------------------------- the team clock
-- pg_cron + pg_net call /api/cron/team every 5 minutes (same pattern as schedule_platform_jobs). Additive.
create or replace function public.schedule_team_job(p_site_url text, p_cron_secret text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  base text := rtrim(btrim(p_site_url), '/');
begin
  if p_site_url !~ '^https://[^\s]+$' then raise exception 'site url must start with https://'; end if;
  if length(coalesce(p_cron_secret, '')) < 8 then raise exception 'cron secret is too short'; end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';
  begin
    execute format('select cron.unschedule(%L)', 'scc-team');
  exception when others then null;
  end;
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'scc-team',
    '3-59/5 * * * *',
    format('select net.http_post(url := %L, headers := jsonb_build_object(''Authorization'', %L, ''Content-Type'', ''application/json''), body := ''{}''::jsonb, timeout_milliseconds := 58000)', base || '/api/cron/team', 'Bearer ' || p_cron_secret)
  );
  return 'scheduled scc-team on ' || base;
end;
$$;
revoke execute on function public.schedule_team_job(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
