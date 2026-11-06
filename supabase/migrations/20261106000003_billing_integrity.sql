-- Billing integrity (additive): a payer always gets what they paid for, a non-payer never keeps a paid plan, and the
-- platform admin sees one "client file" per business. Nothing existing is changed: new functions only.
--
--   billing_integrity_sweep()        service role (daily sweep):
--     1. a paying business whose access is missing (subscription active / trialing / past_due in its period, but the
--        organization's plan differs) gets its plan back at once;
--     2. a plan the platform admin granted by hand with an end date ends on that date;
--     3. a payment that failed (past_due) and was not fixed within 7 days after the period ended → free plan;
--     4. a subscription cancelled "at the end of the period" whose period ended (and no expiry event arrived) → free plan.
--   admin_billing_integrity_sweep()  the same, run by the platform admin from the admin screen.
--   platform_billing_health()        platform admin: one row per business (plan, subscription, payments, credits, flags).
--   platform_billing_file(org)       platform admin: the business's full billing file (payments + receipts, credit packs,
--                                    monthly AI usage, plan history).

create or replace function public.billing_integrity_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  s record;
  n_restored int := 0;
  n_manual int := 0;
  n_past_due int := 0;
  n_period_end int := 0;
begin
  -- 1. paid (or in grace) but no access → restore the plan
  for s in
    select x.organization_id, x.plan_key, o.plan as org_plan
      from public.subscriptions x
      join public.organizations o on o.id = x.organization_id
     where x.status in ('active', 'trialing', 'past_due')
       and (x.current_period_end is null or x.current_period_end > now())
       and x.plan_key <> 'free'
       and o.plan is distinct from x.plan_key
  loop
    perform set_config('scc.platform_admin_write', 'on', true);
    update public.organizations set plan = s.plan_key where id = s.organization_id;
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (s.organization_id, null, 'billing.plan_restored', 'subscription', s.organization_id,
            jsonb_build_object('plan', s.plan_key, 'was', s.org_plan));
    n_restored := n_restored + 1;
  end loop;

  -- 2. a hand-granted plan with an end date ends on that date
  for s in
    select * from public.subscriptions x
     where x.provider = 'manual' and x.status in ('active', 'trialing')
       and x.current_period_end is not null and x.current_period_end < now()
  loop
    perform public.apply_subscription(s.organization_id, s.plan_key, 'canceled', s.provider, null, s.provider_subscription_id, s.billing_interval, s.current_period_end, false);
    n_manual := n_manual + 1;
  end loop;

  -- 3. a failed payment that was not fixed within 7 days after the period ended
  for s in
    select * from public.subscriptions x
     where x.status = 'past_due'
       and x.current_period_end is not null and x.current_period_end < now() - interval '7 days'
  loop
    perform public.apply_subscription(s.organization_id, s.plan_key, 'canceled', s.provider, null, s.provider_subscription_id, s.billing_interval, s.current_period_end, false);
    n_past_due := n_past_due + 1;
  end loop;

  -- 4. cancelled at the end of the period, the period ended a day ago and no expiry event came
  --    (prepaid plans have their own sweep — sweep_prepaid_subscriptions — and are left to it)
  for s in
    select * from public.subscriptions x
     where x.status in ('active', 'trialing') and x.cancel_at_period_end
       and x.current_period_end is not null and x.current_period_end < now() - interval '1 day'
       and x.provider <> 'nowpayments'
       and not (x.provider = 'paypal' and coalesce(x.provider_subscription_id, '') like 'order:%')
  loop
    perform public.apply_subscription(s.organization_id, s.plan_key, 'canceled', s.provider, null, s.provider_subscription_id, s.billing_interval, s.current_period_end, false);
    n_period_end := n_period_end + 1;
  end loop;

  return jsonb_build_object('restored', n_restored, 'manual_expired', n_manual, 'past_due_expired', n_past_due, 'period_ended', n_period_end);
end;
$$;

revoke all on function public.billing_integrity_sweep() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.billing_integrity_sweep() to service_role';
  end if;
end $$;

create or replace function public.admin_billing_integrity_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.billing_integrity_sweep();
end;
$$;
revoke all on function public.admin_billing_integrity_sweep() from public, anon;
grant execute on function public.admin_billing_integrity_sweep() to authenticated;

-- one row per business for the platform admin
create or replace function public.platform_billing_health(p_search text default null, p_limit int default 100)
returns table (
  organization_id uuid, name text, owner_email text, plan text, is_demo boolean,
  sub_plan text, sub_status text, sub_provider text, period_end timestamptz, cancel_at_period_end boolean,
  paid_total numeric, paid_currency text, payments int, last_paid_at timestamptz,
  credits_month bigint, monthly_limit bigint, pack_balance bigint
)
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
    select o.id, o.name::text,
           (select p.email::text from public.organization_members m join public.profiles p on p.id = m.user_id
             where m.organization_id = o.id and m.role = 'owner' order by m.created_at limit 1),
           o.plan::text, coalesce(o.is_demo, false),
           x.plan_key::text, x.status::text, x.provider::text, x.current_period_end, coalesce(x.cancel_at_period_end, false),
           coalesce((select sum(b.amount) from public.billing_payments b where b.organization_id = o.id and b.status = 'paid'), 0),
           (select b.currency::text from public.billing_payments b where b.organization_id = o.id and b.status = 'paid' order by b.paid_at desc limit 1),
           (select count(*)::int from public.billing_payments b where b.organization_id = o.id and b.status = 'paid'),
           (select max(b.paid_at) from public.billing_payments b where b.organization_id = o.id and b.status = 'paid'),
           public.ai_credits_used(o.id),
           public.plan_limit(o.id, 'ai_credits_monthly'),
           public.ai_credit_balance(o.id)
      from public.organizations o
      left join public.subscriptions x on x.organization_id = o.id
     where p_search is null or o.name ilike '%' || p_search || '%'
     order by (o.plan <> 'free') desc, o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke all on function public.platform_billing_health(text, int) from public, anon;
grant execute on function public.platform_billing_health(text, int) to authenticated;

-- the full billing file of one business for the platform admin
create or replace function public.platform_billing_file(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'organization', (select jsonb_build_object('id', o.id, 'name', o.name, 'plan', o.plan, 'created_at', o.created_at) from public.organizations o where o.id = p_org),
    'subscription', (select to_jsonb(x) from public.subscriptions x where x.organization_id = p_org),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'receipt_number', b.receipt_number, 'provider', b.provider, 'plan_key', b.plan_key,
                                                          'billing_interval', b.billing_interval, 'amount', b.amount, 'currency', b.currency, 'status', b.status,
                                                          'paid_at', b.paid_at, 'period_end', b.period_end, 'meta', b.meta) order by b.paid_at desc)
                            from (select * from public.billing_payments where organization_id = p_org order by paid_at desc limit 50) b), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'pack', c.pack, 'credits', c.credits, 'amount', c.amount, 'currency', c.currency,
                                                       'provider', c.provider, 'status', c.status, 'created_at', c.created_at, 'paid_at', c.paid_at) order by c.created_at desc)
                         from (select * from public.credit_purchases where organization_id = p_org order by created_at desc limit 30) c), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('month', u.month, 'credits', u.credits, 'calls', u.calls) order by u.month desc)
                         from (select to_char(date_trunc('month', a.created_at), 'YYYY-MM') as month, sum(a.credits)::bigint as credits, count(*)::int as calls
                                 from public.ai_usage a where a.organization_id = p_org and a.status <> 'error' and a.created_at >= date_trunc('month', now()) - interval '5 months'
                                group by 1) u), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.action, 'metadata', l.metadata) order by l.created_at desc)
                           from (select * from public.audit_logs where organization_id = p_org and action like 'billing.%' order by created_at desc limit 30) l), '[]'::jsonb),
    'pack_balance', public.ai_credit_balance(p_org),
    'credits_month', public.ai_credits_used(p_org),
    'monthly_limit', public.plan_limit(p_org, 'ai_credits_monthly')
  ) into out;
  return out;
end;
$$;
revoke all on function public.platform_billing_file(uuid) from public, anon;
grant execute on function public.platform_billing_file(uuid) to authenticated;

notify pgrst, 'reload schema';
