-- =============================================================================
-- Wave 18 — growth analytics & platform administration (additive only).
--
--  * marketing_spend          monthly ad / marketing spend per lead source
--  * growth_metrics()         ROI, CAC, ROAS, LTV per source + revenue forecast
--  * limit_overrides          the platform admin raises / lowers a limit for one org
--  * price_overrides          a custom (white-label / negotiated) price for one org
--  * AI credit packs          credit_purchases + credit_ledger; the AI reserve uses a
--                             pack credit when the monthly allowance is used up
--  * platform_ai_usage()      AI usage per organization for the admin
-- =============================================================================

update public.plans set features = array_append(features, 'advanced_analytics')
 where key in ('pro', 'business', 'enterprise') and not ('advanced_analytics' = any (features));

-- ------------------------------------------------------------ marketing spend ----
create table if not exists public.marketing_spend (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  source text not null check (source ~ '^[a-z0-9_]{2,40}$'),
  amount numeric(14, 2) not null check (amount >= 0 and amount <= 999999999),
  currency char(3) not null default 'ILS',
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, month, source)
);
create index if not exists marketing_spend_org_month on public.marketing_spend (organization_id, month desc);
alter table public.marketing_spend enable row level security;
drop policy if exists marketing_spend_read on public.marketing_spend;
create policy marketing_spend_read on public.marketing_spend for select to authenticated
  using (public.has_permission(organization_id, 'analytics.read'));
drop policy if exists marketing_spend_write on public.marketing_spend;
create policy marketing_spend_write on public.marketing_spend for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage') or public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'campaigns.manage') or public.has_permission(organization_id, 'settings.manage'));
grant select, insert, update, delete on public.marketing_spend to authenticated;

-- ----------------------------------------------------------- growth metrics ----
-- Attribution: a customer belongs to the lead source of the contact. Revenue = payments
-- recorded on the contact's documents. Spend = marketing_spend of the months in range.
create or replace function public.growth_metrics(p_org uuid, p_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(7, least(p_days, 1095)));
  by_source jsonb;
  totals jsonb;
  ltv jsonb;
  monthly jsonb;
  pipeline jsonb;
  run_rate numeric;
begin
  if not public.has_permission(p_org, 'analytics.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with src as (
    select coalesce(nullif(c.source, ''), 'other') as source, c.id, c.created_at
      from public.contacts c where c.organization_id = p_org
  ), paid as (
    select d.contact_id, sum(p.amount) filter (where p.paid_at >= since) as revenue_period, sum(p.amount) as revenue_all, min(p.paid_at) as first_paid
      from public.payments p join public.documents d on d.id = p.document_id
     where p.organization_id = p_org and d.contact_id is not null
     group by d.contact_id
  ), spend as (
    select source, sum(amount) as spend from public.marketing_spend
     where organization_id = p_org and month >= date_trunc('month', since)::date
     group by source
  ), agg as (
    select s.source,
           count(*) filter (where s.created_at >= since) as leads,
           count(*) filter (where pd.first_paid >= since) as new_customers,
           coalesce(sum(pd.revenue_period), 0) as revenue
      from src s left join paid pd on pd.contact_id = s.id
     group by s.source
  ), joined as (
    select coalesce(a.source, sp.source) as source,
           coalesce(a.leads, 0) as leads, coalesce(a.new_customers, 0) as new_customers,
           coalesce(a.revenue, 0) as revenue, coalesce(sp.spend, 0) as spend
      from agg a full join spend sp on sp.source = a.source
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', source, 'leads', leads, 'customers', new_customers, 'revenue', revenue, 'spend', spend,
           'conversion', case when leads > 0 then round(new_customers::numeric / leads, 4) end,
           'cpl', case when leads > 0 and spend > 0 then round(spend / leads, 2) end,
           'cac', case when new_customers > 0 and spend > 0 then round(spend / new_customers, 2) end,
           'roas', case when spend > 0 then round(revenue / spend, 2) end,
           'roi', case when spend > 0 then round((revenue - spend) / spend, 4) end)
           order by revenue desc, leads desc) filter (where leads > 0 or spend > 0 or revenue > 0), '[]'::jsonb),
         jsonb_build_object(
           'leads', coalesce(sum(leads), 0), 'customers', coalesce(sum(new_customers), 0),
           'revenue', coalesce(sum(revenue), 0), 'spend', coalesce(sum(spend), 0),
           'cac', case when sum(new_customers) > 0 and sum(spend) > 0 then round(sum(spend) / sum(new_customers), 2) end,
           'roas', case when sum(spend) > 0 then round(sum(revenue) / sum(spend), 2) end,
           'roi', case when sum(spend) > 0 then round((sum(revenue) - sum(spend)) / sum(spend), 4) end)
    into by_source, totals
    from joined;

  -- lifetime value (all time): average paid per paying customer, purchases, months active
  select jsonb_build_object(
           'customers', count(*),
           'ltv', round(coalesce(avg(total), 0), 2),
           'avg_orders', round(coalesce(avg(orders), 0), 2),
           'avg_months', round(coalesce(avg(months), 0), 1))
    into ltv
    from (
      select d.contact_id, sum(p.amount) as total, count(distinct d.id) as orders,
             greatest(1, extract(epoch from (max(p.paid_at) - min(p.paid_at))) / 2629800.0) as months
        from public.payments p join public.documents d on d.id = p.document_id
       where p.organization_id = p_org and d.contact_id is not null
       group by d.contact_id
    ) x;

  -- revenue per month (last 12) and the run rate of the last 3 full months
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'value', coalesce(v, 0)) order by m), '[]'::jsonb)
    into monthly
    from (
      select gs::date as m,
             (select sum(p.amount) from public.payments p
               where p.organization_id = p_org and p.paid_at >= gs and p.paid_at < gs + interval '1 month') as v
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') gs
    ) mm;
  select coalesce(sum(p.amount), 0) / 3 into run_rate
    from public.payments p
   where p.organization_id = p_org
     and p.paid_at >= date_trunc('month', now()) - interval '3 months'
     and p.paid_at < date_trunc('month', now());

  -- forecast: open deals weighted by stage probability, by expected close month (next 3 months)
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'pipeline', coalesce(w, 0), 'run_rate', round(run_rate, 2),
                                               'forecast', round(coalesce(w, 0) + run_rate, 2)) order by m), '[]'::jsonb)
    into pipeline
    from (
      select gs::date as m,
             (select sum(d.value * ps.probability / 100.0)
                from public.deals d join public.pipeline_stages ps on ps.id = d.stage_id
               where d.organization_id = p_org and d.status = 'open'
                 and coalesce(d.expected_close_date, (now() + interval '30 days')::date) >= gs
                 and coalesce(d.expected_close_date, (now() + interval '30 days')::date) < gs + interval '1 month') as w
        from generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '2 months', interval '1 month') gs
    ) f;

  return jsonb_build_object('days', p_days, 'by_source', by_source, 'totals', totals, 'ltv', ltv, 'monthly', monthly, 'forecast', pipeline, 'run_rate', round(run_rate, 2));
end;
$$;
revoke all on function public.growth_metrics(uuid, int) from public, anon;
grant execute on function public.growth_metrics(uuid, int) to authenticated;

-- ---------------------------------------------------- limits & price overrides ----
alter table public.organizations add column if not exists limit_overrides jsonb not null default '{}'::jsonb;
alter table public.organizations add column if not exists price_overrides jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.organizations add constraint organizations_limit_overrides_object check (jsonb_typeof(limit_overrides) = 'object' and pg_column_size(limit_overrides) < 4000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.organizations add constraint organizations_price_overrides_object check (jsonb_typeof(price_overrides) = 'object' and pg_column_size(price_overrides) < 4000);
exception when duplicate_object then null; end $$;

-- guard (wave 1 + 4) extended: overrides are platform-admin only
create or replace function public.guard_org_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and not public.is_platform_admin()
     and current_setting('scc.platform_admin_write', true) is distinct from 'on' then
    if new.plan is distinct from old.plan
       or new.parent_organization_id is distinct from old.parent_organization_id
       or new.created_by is distinct from old.created_by
       or new.limit_overrides is distinct from old.limit_overrides
       or new.price_overrides is distinct from old.price_overrides then
      raise exception 'protected organization column' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

-- plan_limit (wave 4) + per-organization override: a number replaces the plan's limit,
-- -1 means unlimited; a key that is not overridden keeps the plan's value
create or replace function public.plan_limit(org uuid, limit_key text)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when o.limit_overrides ? limit_key and jsonb_typeof(o.limit_overrides -> limit_key) = 'number' then
      nullif(greatest((o.limit_overrides ->> limit_key)::bigint, -1), -1)
    else (p.limits ->> limit_key)::bigint
  end
  from public.organizations o
  join public.plans p on p.key = o.plan
  where o.id = org;
$$;

-- the effective limits (plan + overrides) for screens
create or replace function public.effective_limits(org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p.limits, '{}'::jsonb) || coalesce((
           select jsonb_object_agg(k, case when v::text = '-1' then 'null'::jsonb else v end)
             from jsonb_each(o.limit_overrides) e(k, v) where jsonb_typeof(v) = 'number'), '{}'::jsonb)
    from public.organizations o join public.plans p on p.key = o.plan
   where o.id = org and public.is_org_member(org);
$$;
revoke all on function public.effective_limits(uuid) from public, anon;
grant execute on function public.effective_limits(uuid) to authenticated;

create or replace function public.platform_set_overrides(p_org uuid, p_limits jsonb, p_prices jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k text; v jsonb; plan_key text; iv text;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_limits is not null then
    if jsonb_typeof(p_limits) <> 'object' then raise exception 'invalid_limits' using errcode = '22023'; end if;
    for k, v in select * from jsonb_each(p_limits) loop
      if k !~ '^[a-z_]{2,40}$' or jsonb_typeof(v) <> 'number' or (v::text)::numeric < -1 or (v::text)::numeric > 1000000000 then
        raise exception 'invalid_limits' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'object' then raise exception 'invalid_prices' using errcode = '22023'; end if;
    for plan_key, v in select * from jsonb_each(p_prices) loop
      if not exists (select 1 from public.plans where key = plan_key) or jsonb_typeof(v) <> 'object' then
        raise exception 'invalid_prices' using errcode = '22023';
      end if;
      for iv in select jsonb_object_keys(v) loop
        if iv not in ('month', 'year', 'month_usd', 'year_usd') or jsonb_typeof(v -> iv) <> 'number' or (v ->> iv)::numeric <= 0 or (v ->> iv)::numeric > 1000000 then
          raise exception 'invalid_prices' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end if;
  perform set_config('scc.platform_admin_write', 'on', true);
  update public.organizations
     set limit_overrides = coalesce(p_limits, limit_overrides),
         price_overrides = coalesce(p_prices, price_overrides)
   where id = p_org;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'platform.overrides', 'organization', p_org, jsonb_build_object('limits', p_limits, 'prices', p_prices));
end;
$$;
revoke all on function public.platform_set_overrides(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.platform_set_overrides(uuid, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------- AI credit packs ----
create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pack text not null check (pack ~ '^[a-z0-9_]{2,40}$'),
  credits int not null check (credits > 0 and credits <= 10000000),
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'USD',
  provider text not null check (provider in ('paypal', 'nowpayments', 'manual')),
  provider_order_id text unique check (provider_order_id is null or char_length(provider_order_id) <= 120),
  status text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists credit_purchases_org on public.credit_purchases (organization_id, created_at desc);
alter table public.credit_purchases enable row level security;
drop policy if exists credit_purchases_read on public.credit_purchases;
create policy credit_purchases_read on public.credit_purchases for select to authenticated
  using (public.has_permission(organization_id, 'billing.read'));
revoke insert, update, delete on public.credit_purchases from anon, authenticated;
grant select on public.credit_purchases to authenticated;

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'ai' check (kind in ('ai')),
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'usage', 'admin', 'refund')),
  purchase_id uuid references public.credit_purchases (id) on delete set null,
  usage_id bigint,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_org on public.credit_ledger (organization_id, kind, created_at desc);
create unique index if not exists credit_ledger_purchase_once on public.credit_ledger (purchase_id) where reason = 'purchase';
alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_read on public.credit_ledger;
create policy credit_ledger_read on public.credit_ledger for select to authenticated
  using (public.has_permission(organization_id, 'billing.read'));
revoke insert, update, delete on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;

create or replace function public.ai_credit_balance(org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, coalesce(sum(delta), 0)) from public.credit_ledger where organization_id = org and kind = 'ai';
$$;
revoke all on function public.ai_credit_balance(uuid) from public, anon, authenticated;

create or replace function public.org_credit_balance(org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_org_member(org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.ai_credit_balance(org);
end;
$$;
revoke all on function public.org_credit_balance(uuid) from public, anon;
grant execute on function public.org_credit_balance(uuid) to authenticated;

-- payment confirmed (server, after the provider verified it) → credits, exactly once
create or replace function public.grant_credit_purchase(p_purchase uuid, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cp public.credit_purchases;
begin
  select * into cp from public.credit_purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if cp.status = 'paid' then return jsonb_build_object('ok', true, 'already', true, 'credits', cp.credits); end if;
  if upper(coalesce(p_currency, '')) <> upper(cp.currency) or coalesce(p_amount, 0) + 0.01 < cp.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;
  update public.credit_purchases set status = 'paid', paid_at = now() where id = cp.id;
  insert into public.credit_ledger (organization_id, kind, delta, reason, purchase_id, created_by)
  values (cp.organization_id, 'ai', cp.credits, 'purchase', cp.id, cp.created_by)
  on conflict do nothing;
  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  select cp.organization_id, m.user_id, 'billing', 'credits.addedNotification', jsonb_build_object('credits', cp.credits), '/billing'
    from public.organization_members m
   where m.organization_id = cp.organization_id and m.role in ('agency_owner', 'owner', 'admin');
  return jsonb_build_object('ok', true, 'credits', cp.credits);
end;
$$;
revoke all on function public.grant_credit_purchase(uuid, numeric, text) from public, anon, authenticated;

create or replace function public.platform_grant_credits(p_org uuid, p_credits int, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_credits = 0 or abs(p_credits) > 10000000 then raise exception 'invalid_credits' using errcode = '22023'; end if;
  insert into public.credit_ledger (organization_id, kind, delta, reason, note, created_by)
  values (p_org, 'ai', p_credits, 'admin', left(p_note, 300), auth.uid());
  return public.ai_credit_balance(p_org);
end;
$$;
revoke all on function public.platform_grant_credits(uuid, int, text) from public, anon;
grant execute on function public.platform_grant_credits(uuid, int, text) to authenticated;

-- the AI reserve (wave 4 / wave 9) + pack credits when the monthly allowance is used up
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
  over boolean := false;
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
  over := lim is not null and public.ai_credits_used(p_org) + 1 > lim;
  -- wave 18: over the monthly allowance → one credit from a purchased pack (if any)
  if over and public.ai_credit_balance(p_org) < 1 then
    raise exception 'plan_limit:ai_credits' using errcode = 'P0001', hint = 'upgrade';
  end if;
  insert into public.ai_usage (organization_id, user_id, agent_id, feature, credits, status)
  values (p_org, auth.uid(), p_agent, p_feature, 1, 'pending')
  returning id into usage_id;
  if over then
    insert into public.credit_ledger (organization_id, kind, delta, reason, usage_id)
    values (p_org, 'ai', -1, 'usage', usage_id);
  end if;
  return usage_id;
end;
$$;

create or replace function public.reserve_ai_credits_system(p_org uuid, p_feature text, p_agent uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  usage_id bigint;
  demo boolean;
  over boolean := false;
begin
  select is_demo into demo from public.organizations where id = p_org;
  if demo is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if demo then
    raise exception 'demo_mode' using errcode = 'P0001';
  end if;
  if not public.public_rate_limit('ai-sys:' || p_org::text, 60, 60) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  lim := public.plan_limit(p_org, 'ai_credits_monthly');
  over := lim is not null and public.ai_credits_used(p_org) + 1 > lim;
  -- wave 18: over the monthly allowance → one credit from a purchased pack (if any)
  if over and public.ai_credit_balance(p_org) < 1 then
    raise exception 'plan_limit:ai_credits' using errcode = 'P0001', hint = 'upgrade';
  end if;
  insert into public.ai_usage (organization_id, user_id, agent_id, feature, credits, status)
  values (p_org, null, p_agent, p_feature, 1, 'pending')
  returning id into usage_id;
  if over then
    insert into public.credit_ledger (organization_id, kind, delta, reason, usage_id)
    values (p_org, 'ai', -1, 'usage', usage_id);
  end if;
  return usage_id;
end;
$$;


-- a failed AI call gives the pack credit back
create or replace function public.ai_usage_refund_pack()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.credit_ledger where usage_id = new.id and reason = 'usage')
     and not exists (select 1 from public.credit_ledger where usage_id = new.id and reason = 'refund') then
    insert into public.credit_ledger (organization_id, kind, delta, reason, usage_id)
    values (new.organization_id, 'ai', 1, 'refund', new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists ai_usage_refund_pack on public.ai_usage;
create trigger ai_usage_refund_pack after update of status on public.ai_usage
  for each row when (new.status = 'error' and old.status is distinct from 'error')
  execute function public.ai_usage_refund_pack();

-- ------------------------------------------------------- admin: AI usage per org ----
create or replace function public.platform_ai_usage(p_days int default 30, p_limit int default 50)
returns table (organization_id uuid, name text, plan text, credits bigint, calls bigint, errors bigint, input_tokens bigint, output_tokens bigint, pack_balance bigint, monthly_limit bigint, top_feature text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.plan::text,
         coalesce(sum(u.credits) filter (where u.status = 'ok'), 0)::bigint,
         count(u.id)::bigint,
         count(u.id) filter (where u.status = 'error')::bigint,
         coalesce(sum(u.input_tokens), 0)::bigint,
         coalesce(sum(u.output_tokens), 0)::bigint,
         public.ai_credit_balance(o.id),
         public.plan_limit(o.id, 'ai_credits_monthly'),
         (select u2.feature from public.ai_usage u2 where u2.organization_id = o.id and u2.created_at > now() - make_interval(days => p_days)
           group by u2.feature order by count(*) desc limit 1)
    from public.organizations o
    join public.ai_usage u on u.organization_id = o.id and u.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
   group by o.id
   order by 4 desc
   limit greatest(1, least(p_limit, 200));
end;
$$;
revoke all on function public.platform_ai_usage(int, int) from public, anon;
grant execute on function public.platform_ai_usage(int, int) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.credit_purchases, public.credit_ledger, public.marketing_spend to service_role';
    execute 'grant execute on function public.grant_credit_purchase(uuid, numeric, text), public.ai_credit_balance(uuid) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
