-- ============================================================================
-- SUPER CODER CLOUD — 0010 Commercial layer
--   plans + subscriptions (billing), plan limits enforced IN THE DATABASE,
--   AI agents + AI usage/credits, rate limiting, webhook idempotency,
--   keep-alive ping. Purely additive: no existing object is dropped.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Plans catalogue (editable later by platform admins / migrations).
-- limits: null value = unlimited.
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  sort int not null default 0,
  price_monthly numeric(10, 2) not null default 0 check (price_monthly >= 0),
  price_yearly numeric(10, 2) not null default 0 check (price_yearly >= 0),
  currency char(3) not null default 'ILS',
  limits jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  is_public boolean not null default true,
  contact_sales boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.plans (key, sort, price_monthly, price_yearly, currency, limits, features, contact_sales) values
  ('free', 0, 0, 0, 'ILS',
    '{"contacts": 250, "members": 2, "ai_credits_monthly": 50, "ai_agents": 1}',
    array['crm', 'team', 'demo', 'csv_export', 'ai_basic'], false),
  ('pro', 1, 149, 1490, 'ILS',
    '{"contacts": 5000, "members": 5, "ai_credits_monthly": 1000, "ai_agents": 3}',
    array['crm', 'team', 'demo', 'csv_export', 'ai_basic', 'ai_agents', 'audit_log', 'priority_support'], false),
  ('business', 2, 399, 3990, 'ILS',
    '{"contacts": 50000, "members": 25, "ai_credits_monthly": 10000, "ai_agents": 20}',
    array['crm', 'team', 'demo', 'csv_export', 'ai_basic', 'ai_agents', 'audit_log', 'priority_support', 'white_label', 'api_access'], false),
  ('enterprise', 3, 0, 0, 'ILS',
    '{"contacts": null, "members": null, "ai_credits_monthly": null, "ai_agents": null}',
    array['crm', 'team', 'demo', 'csv_export', 'ai_basic', 'ai_agents', 'audit_log', 'priority_support', 'white_label', 'api_access', 'sso', 'dedicated_support'], true)
on conflict (key) do nothing;

-- organizations.plan now references the catalogue (existing rows are 'free').
do $$ begin
  alter table public.organizations
    add constraint organizations_plan_fk foreign key (plan) references public.plans (key);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Subscriptions — written ONLY by the server (verified webhooks / admin RPC).
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  provider text not null check (provider in ('stripe', 'manual')),
  provider_customer_id text check (provider_customer_id is null or char_length(provider_customer_id) <= 120),
  provider_subscription_id text unique check (provider_subscription_id is null or char_length(provider_subscription_id) <= 120),
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Webhook idempotency: each provider event is processed once.
create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null check (char_length(event_id) <= 200),
  type text not null check (char_length(type) <= 120),
  organization_id uuid references public.organizations (id) on delete set null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- AI agents & usage
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  instructions text not null default '' check (char_length(instructions) <= 8000),
  provider text not null default 'openai' check (provider in ('openai', 'anthropic')),
  model text not null check (model ~ '^[A-Za-z0-9._:-]{2,80}$'),
  temperature numeric(3, 2) not null default 0.3 check (temperature between 0 and 1),
  language text not null default 'he' check (language in ('he', 'ar', 'en')),
  allowed_tools text[] not null default array['crm_lookup'],
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (allowed_tools <@ array['crm_lookup', 'draft_message']::text[])
);
create trigger ai_agents_updated_at before update on public.ai_agents
  for each row execute function public.set_updated_at();

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  agent_id uuid,
  feature text not null check (feature in ('contact_summary', 'followup_draft', 'agent_chat')),
  provider text,
  model text,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  credits int not null default 1 check (credits >= 0),
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  created_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references public.ai_agents (organization_id, id) on delete set null (agent_id)
);
create index if not exists ai_usage_org_month_idx on public.ai_usage (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, per authenticated user + key).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  ws timestamptz;
  c int;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (bucket, window_start, count)
  values (uid::text || ':' || left(p_key, 60), ws, 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning count into c;
  -- opportunistic cleanup
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return c <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entitlements
-- ---------------------------------------------------------------------------
create or replace function public.plan_limit(org uuid, limit_key text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (p.limits ->> limit_key)::bigint
  from public.organizations o
  join public.plans p on p.key = o.plan
  where o.id = org;
$$;

create or replace function public.ai_credits_used(org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(credits), 0)
  from public.ai_usage
  where organization_id = org
    and status <> 'error'
    and created_at >= date_trunc('month', now());
$$;

create or replace function public.org_entitlements(org uuid)
returns table (
  plan_key text,
  limits jsonb,
  features text[],
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  contacts_used bigint,
  members_used bigint,
  ai_credits_used bigint,
  ai_agents_used bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_org_member(org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    o.plan,
    p.limits,
    p.features,
    s.status,
    s.current_period_end,
    coalesce(s.cancel_at_period_end, false),
    (select count(*) from public.contacts c where c.organization_id = org),
    (select count(*) from public.organization_members m where m.organization_id = org),
    public.ai_credits_used(org),
    (select count(*) from public.ai_agents a where a.organization_id = org)
  from public.organizations o
  join public.plans p on p.key = o.plan
  left join public.subscriptions s on s.organization_id = o.id
  where o.id = org;
end;
$$;

-- Plan-limit guard (serialised per organization with a row lock).
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  used bigint;
  key text := tg_argv[0];
begin
  -- bootstrap inserts (owner on org creation) are never limited
  if current_setting('scc.bootstrap', true) = 'on' then
    return new;
  end if;
  perform 1 from public.organizations where id = new.organization_id for update;
  lim := public.plan_limit(new.organization_id, key);
  if lim is null then
    return new;
  end if;
  if key = 'contacts' then
    select count(*) into used from public.contacts where organization_id = new.organization_id;
  elsif key = 'members' then
    select (select count(*) from public.organization_members where organization_id = new.organization_id)
         + (select count(*) from public.invitations
             where organization_id = new.organization_id and accepted_at is null and expires_at > now()
               and (tg_table_name <> 'organization_members'))
      into used;
  elsif key = 'ai_agents' then
    select count(*) into used from public.ai_agents where organization_id = new.organization_id;
  end if;
  if used >= lim then
    raise exception 'plan_limit:%', key using errcode = 'P0001', hint = 'upgrade';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_plan_limit on public.contacts;
create trigger contacts_plan_limit before insert on public.contacts
  for each row execute function public.enforce_plan_limit('contacts');
drop trigger if exists invitations_plan_limit on public.invitations;
create trigger invitations_plan_limit before insert on public.invitations
  for each row execute function public.enforce_plan_limit('members');
drop trigger if exists members_plan_limit on public.organization_members;
create trigger members_plan_limit before insert on public.organization_members
  for each row execute function public.enforce_plan_limit('members');
drop trigger if exists ai_agents_plan_limit on public.ai_agents;
create trigger ai_agents_plan_limit before insert on public.ai_agents
  for each row execute function public.enforce_plan_limit('ai_agents');

-- ---------------------------------------------------------------------------
-- AI credits: reserve before calling a provider, finalize after.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_ai_credits(p_org uuid, p_feature text, p_agent uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  usage_id bigint;
  demo boolean;
begin
  if not public.has_permission(p_org, 'ai.use') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select is_demo into demo from public.organizations where id = p_org;
  if demo then
    raise exception 'demo_mode' using errcode = 'P0001';
  end if;
  if not public.check_rate_limit('ai:' || p_org::text, 20, 60) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  lim := public.plan_limit(p_org, 'ai_credits_monthly');
  if lim is not null and public.ai_credits_used(p_org) + 1 > lim then
    raise exception 'plan_limit:ai_credits' using errcode = 'P0001', hint = 'upgrade';
  end if;
  insert into public.ai_usage (organization_id, user_id, agent_id, feature, credits, status)
  values (p_org, auth.uid(), p_agent, p_feature, 1, 'pending')
  returning id into usage_id;
  return usage_id;
end;
$$;

create or replace function public.finalize_ai_usage(
  p_usage_id bigint, p_provider text, p_model text, p_input int, p_output int, p_ok boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ai_usage
     set provider = left(p_provider, 40),
         model = left(p_model, 80),
         input_tokens = greatest(p_input, 0),
         output_tokens = greatest(p_output, 0),
         credits = case when p_ok then greatest(1, ceil((greatest(p_input, 0) + greatest(p_output, 0)) / 1000.0)::int) else 0 end,
         status = case when p_ok then 'ok' else 'error' end
   where id = p_usage_id and user_id = auth.uid() and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Billing writes (service role only) and manual plan assignment (platform admin)
-- ---------------------------------------------------------------------------
create or replace function public.apply_subscription(
  p_org uuid, p_plan text, p_status text, p_provider text,
  p_customer text default null, p_subscription text default null,
  p_interval text default null, p_period_end timestamptz default null, p_cancel boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  effective text;
begin
  insert into public.subscriptions as s (organization_id, plan_key, status, provider, provider_customer_id,
                                         provider_subscription_id, billing_interval, current_period_end, cancel_at_period_end)
  values (p_org, p_plan, p_status, p_provider, p_customer, p_subscription, p_interval, p_period_end, coalesce(p_cancel, false))
  on conflict (organization_id) do update set
    plan_key = excluded.plan_key,
    status = excluded.status,
    provider = excluded.provider,
    provider_customer_id = coalesce(excluded.provider_customer_id, s.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, s.provider_subscription_id),
    billing_interval = excluded.billing_interval,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end;

  effective := case when p_status in ('active', 'trialing', 'past_due') then p_plan else 'free' end;
  update public.organizations set plan = effective where id = p_org;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'billing.plan_changed', 'subscription', p_org,
          jsonb_build_object('plan', effective, 'status', p_status, 'provider', p_provider));
end;
$$;

create or replace function public.admin_set_plan(p_org uuid, p_plan text, p_period_end timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform set_config('scc.platform_admin_write', 'on', true);
  perform public.apply_subscription(p_org, p_plan, 'active', 'manual', null, null, null, p_period_end, false);
end;
$$;

-- Platform admins may change the protected plan column only through admin_set_plan.
create or replace function public.guard_org_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and not public.is_platform_admin()
     and current_setting('scc.platform_admin_write', true) is distinct from 'on' then
    if new.plan is distinct from old.plan
       or new.parent_organization_id is distinct from old.parent_organization_id
       or new.created_by is distinct from old.created_by then
      raise exception 'protected organization column' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

-- Keep-alive / health probe (no data exposed).
create or replace function public.ping()
returns boolean
language sql
stable
as $$ select true; $$;

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_usage enable row level security;
alter table public.rate_limits enable row level security;

create policy plans_select on public.plans for select to anon, authenticated using (is_public);
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_org_member(organization_id));
create policy ai_agents_select on public.ai_agents for select to authenticated
  using (public.has_permission(organization_id, 'ai.use'));
create policy ai_agents_insert on public.ai_agents for insert to authenticated
  with check (public.has_permission(organization_id, 'ai.manage'));
create policy ai_agents_update on public.ai_agents for update to authenticated
  using (public.has_permission(organization_id, 'ai.manage'))
  with check (public.has_permission(organization_id, 'ai.manage'));
create policy ai_agents_delete on public.ai_agents for delete to authenticated
  using (public.has_permission(organization_id, 'ai.manage'));
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (public.has_permission(organization_id, 'billing.read'));
-- billing_events, rate_limits: no client policy (service role / definer functions only).

grant select on public.plans to anon, authenticated;
grant select on public.subscriptions, public.ai_usage to authenticated;
grant select, insert, update, delete on public.ai_agents to authenticated;
revoke all on public.billing_events, public.rate_limits from anon, authenticated;

revoke execute on function
  public.check_rate_limit(text, int, int),
  public.plan_limit(uuid, text),
  public.ai_credits_used(uuid),
  public.org_entitlements(uuid),
  public.enforce_plan_limit(),
  public.reserve_ai_credits(uuid, text, uuid),
  public.finalize_ai_usage(bigint, text, text, int, int, boolean),
  public.apply_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean),
  public.admin_set_plan(uuid, text, timestamptz),
  public.ping()
from public, anon;

grant execute on function
  public.check_rate_limit(text, int, int),
  public.org_entitlements(uuid),
  public.reserve_ai_credits(uuid, text, uuid),
  public.finalize_ai_usage(bigint, text, text, int, int, boolean),
  public.admin_set_plan(uuid, text, timestamptz)
to authenticated;
grant execute on function public.ping() to anon, authenticated;

do $$ begin
  execute 'grant execute on function public.apply_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean) to service_role';
exception when undefined_object then null; end $$;
