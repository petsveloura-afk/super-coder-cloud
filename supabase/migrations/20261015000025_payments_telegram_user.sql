-- ============================================================================
-- SUPER CODER CLOUD — 0025
--   A. Telegram by personal account (MTProto, through the bridge) next to the bot
--   B. More ways to pay for a plan: PayPal (PayPal or card, money to PayPal),
--      Lemon Squeezy (merchant of record, payouts to PayPal/bank) and crypto
--      (NOWPayments, money to a crypto wallet) — next to Stripe.
--      Every payment is recorded with a receipt number; prepaid (crypto)
--      periods expire automatically.
-- Additive only.
-- ============================================================================

-- ------------------------------------------------------------ A. channels
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.channel_accounts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.channel_accounts drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%channel %' loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.ai_agents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%autopilot_channels%' loop
    execute format('alter table public.ai_agents drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.channel_accounts add constraint channel_accounts_kind_check
  check (kind in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'telegram_user'));
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'web', 'telegram_user'));
alter table public.ai_agents add constraint ai_agents_autopilot_channels_check
  check (autopilot_channels <@ array['web', 'telegram', 'whatsapp', 'whatsapp_qr', 'sms', 'email', 'telegram_user']::text[]);

-- agents that answer Telegram bots also answer the personal Telegram account
update public.ai_agents set autopilot_channels = array_append(autopilot_channels, 'telegram_user')
 where 'telegram' = any (autopilot_channels) and not ('telegram_user' = any (autopilot_channels));

-- ------------------------------------------------------------ B. providers
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.subscriptions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%provider%' loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.subscriptions add constraint subscriptions_provider_check
  check (provider in ('stripe', 'manual', 'paypal', 'lemonsqueezy', 'nowpayments'));
alter table public.subscriptions add column if not exists renewal_reminded_at timestamptz;

-- plan prices in USD (crypto checkout / USD processors); editable by the platform owner
alter table public.plans add column if not exists price_monthly_usd numeric(10, 2);
alter table public.plans add column if not exists price_yearly_usd numeric(10, 2);
update public.plans set price_monthly_usd = round(price_monthly * 0.27, 0) where price_monthly_usd is null;
update public.plans set price_yearly_usd = round(price_yearly * 0.27, 0) where price_yearly_usd is null;

-- PayPal product / billing plans created automatically on the first checkout
create table if not exists public.billing_provider_plans (
  provider text not null check (provider in ('paypal', 'lemonsqueezy', 'nowpayments', 'stripe')),
  plan_key text not null references public.plans (key) on delete cascade,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  amount numeric(10, 2),
  currency text,
  created_at timestamptz not null default now(),
  primary key (provider, plan_key, billing_interval)
);
alter table public.billing_provider_plans enable row level security;
revoke all on public.billing_provider_plans from anon, authenticated;

-- every payment (all providers) with a sequential receipt number
create sequence if not exists public.billing_receipt_seq start 1001;
create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'paypal', 'lemonsqueezy', 'nowpayments', 'manual')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  plan_key text references public.plans (key) on delete set null,
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'ILS' check (char_length(currency) between 3 and 10),
  status text not null default 'paid' check (status in ('paid', 'refunded', 'pending', 'failed')),
  receipt_number bigint not null default nextval('public.billing_receipt_seq'),
  payer_email text check (payer_email is null or char_length(payer_email) <= 200),
  payer_name text check (payer_name is null or char_length(payer_name) <= 200),
  period_end timestamptz,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, external_id),
  unique (receipt_number)
);
create index if not exists billing_payments_org_idx on public.billing_payments (organization_id, paid_at desc);
alter table public.billing_payments enable row level security;
drop policy if exists billing_payments_select on public.billing_payments;
create policy billing_payments_select on public.billing_payments for select to authenticated
  using (public.has_permission(organization_id, 'billing.manage') or public.is_platform_admin());
revoke insert, update, delete on public.billing_payments from authenticated, anon;
grant select on public.billing_payments to authenticated;

create or replace function public.record_billing_payment(
  p_org uuid, p_provider text, p_external text, p_plan text, p_interval text,
  p_amount numeric, p_currency text, p_email text default null, p_name text default null,
  p_period_end timestamptz default null, p_meta jsonb default '{}'::jsonb, p_status text default 'paid'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.billing_payments;
  is_new boolean := false;
begin
  -- already recorded (webhook retry / return page + webhook) → same receipt, no number used up
  select * into r from public.billing_payments where provider = p_provider and external_id = left(p_external, 200);
  if r.id is not null then
    return jsonb_build_object('id', r.id, 'receipt_number', r.receipt_number, 'new', false);
  end if;
  insert into public.billing_payments (organization_id, provider, external_id, plan_key, billing_interval, amount, currency, status, payer_email, payer_name, period_end, meta)
  values (p_org, p_provider, left(p_external, 200), p_plan, p_interval, greatest(coalesce(p_amount, 0), 0), upper(left(coalesce(p_currency, 'ILS'), 10)),
          coalesce(p_status, 'paid'), left(p_email, 200), left(p_name, 200), p_period_end,
          case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end)
  on conflict (provider, external_id) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.billing_payments where provider = p_provider and external_id = left(p_external, 200);
  else
    is_new := true;
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_org, null, 'billing.payment', 'billing_payment', r.id,
            jsonb_build_object('provider', p_provider, 'amount', r.amount, 'currency', r.currency, 'receipt', r.receipt_number));
  end if;
  return jsonb_build_object('id', r.id, 'receipt_number', r.receipt_number, 'new', is_new);
end;
$$;

-- prepaid periods (crypto / one-off): expire after the period + 3 days grace;
-- returns subscriptions that should get a renewal reminder (3 days before the end)
create or replace function public.sweep_prepaid_subscriptions()
returns table (organization_id uuid, plan_key text, period_end timestamptz, provider text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare s record;
begin
  for s in
    select * from public.subscriptions x
     where x.provider = 'nowpayments' and x.status = 'active' and x.current_period_end < now() - interval '3 days'
  loop
    perform public.apply_subscription(s.organization_id, s.plan_key, 'canceled', 'nowpayments', null, null, s.billing_interval, s.current_period_end, false);
  end loop;
  return query
    update public.subscriptions x set renewal_reminded_at = now()
     where x.provider = 'nowpayments' and x.status = 'active'
       and x.current_period_end between now() and now() + interval '3 days'
       and (x.renewal_reminded_at is null or x.renewal_reminded_at < x.current_period_end - interval '10 days')
    returning x.organization_id, x.plan_key, x.current_period_end, x.provider;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_billing_payment(uuid, text, text, text, text, numeric, text, text, text, timestamptz, jsonb, text)',
    'public.sweep_prepaid_subscriptions()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.billing_provider_plans, public.billing_payments to service_role';
    execute 'grant usage, select on sequence public.billing_receipt_seq to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------ C. AI reliability
-- Conversations that were handed to the team only because the AI provider was
-- busy (and no person answered since) go back to the AI agent.
update public.conversations c
   set ai_mode = 'auto', handoff_at = null
 where c.ai_mode = 'human'
   and c.id::text in (
         select substring(n.link from 'c=([0-9a-f-]{36})')
           from public.notifications n
          where n.title_key = 'inbox.handoffNotification' and coalesce(n.params ->> 'reason', '') like 'ai.%')
   and not exists (
         select 1 from public.messages m
          where m.conversation_id = c.id and m.direction = 'out' and m.sent_by is not null
            and m.created_at >= coalesce(c.handoff_at, c.created_at));

-- Safety net: customer messages that got no AI answer (provider busy, timeout)
-- are answered by the next cron run (every 1–5 minutes).
create or replace function public.ai_pending_replies(p_limit int default 20)
returns table (conversation_id uuid, organization_id uuid, message_id uuid, channel text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.organization_id, lm.id, c.channel
    from public.conversations c
    join lateral (
      select m.id, m.direction, m.created_at, m.meta
        from public.messages m where m.conversation_id = c.id
       order by m.created_at desc limit 1
    ) lm on true
   where c.ai_mode = 'auto'
     and c.status = 'open'
     and c.last_message_at > now() - interval '3 hours'
     -- never groups / channels (negative Telegram chat ids) or automated e-mails (newsletters, bounces)
     and not (c.channel in ('telegram', 'telegram_user') and c.external_id like '-%')
     and coalesce(lm.meta ->> 'automated', '') <> 'true'
     and (
       (lm.direction = 'in' and lm.created_at < now() - interval '75 seconds')
       or (lm.direction = 'out' and coalesce(lm.meta ->> 'fallback', '') = 'true' and lm.created_at < now() - interval '60 seconds')
     )
     and exists (
       select 1 from public.ai_agents a
        where a.organization_id = c.organization_id and a.enabled and c.channel = any (a.autopilot_channels))
   order by c.last_message_at
   limit greatest(1, least(p_limit, 100));
$$;
do $$ begin
  execute 'revoke execute on function public.ai_pending_replies(int) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_pending_replies(int) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
