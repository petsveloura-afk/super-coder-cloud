-- ============================================================================
-- SUPER CODER CLOUD — 0028: card payments through PayPal without a PayPal account
--   One-time PayPal orders (guest card checkout) pay a month / year in advance,
--   exactly like crypto: the period ends automatically (after 3 days of grace)
--   and a renewal reminder is sent 3 days before. Subscriptions made this way
--   carry provider 'paypal' and provider_subscription_id 'order:<id>'.
-- Additive only.
-- ============================================================================

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
     where (x.provider = 'nowpayments' or (x.provider = 'paypal' and x.provider_subscription_id like 'order:%'))
       and x.status = 'active' and x.current_period_end < now() - interval '3 days'
  loop
    perform public.apply_subscription(s.organization_id, s.plan_key, 'canceled', s.provider, null, s.provider_subscription_id, s.billing_interval, s.current_period_end, false);
  end loop;
  return query
    update public.subscriptions x set renewal_reminded_at = now()
     where (x.provider = 'nowpayments' or (x.provider = 'paypal' and x.provider_subscription_id like 'order:%'))
       and x.status = 'active'
       and x.current_period_end between now() and now() + interval '3 days'
       and (x.renewal_reminded_at is null or x.renewal_reminded_at < x.current_period_end - interval '10 days')
    returning x.organization_id, x.plan_key, x.current_period_end, x.provider;
end;
$$;

do $$ begin
  execute 'revoke execute on function public.sweep_prepaid_subscriptions() from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.sweep_prepaid_subscriptions() to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
