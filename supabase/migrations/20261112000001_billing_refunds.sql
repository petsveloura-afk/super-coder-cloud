-- Round 12 — billing: refunds / chargebacks, payment failures, admin voiding (additive, idempotent).
--
--   • credit_purchases.status may now be 'refunded' (the old values stay valid)
--   • revoke_credit_purchase(purchase): when a credit-pack payment is refunded or reversed (chargeback) the credits it
--     added are taken back — never more than what is left of that kind, so the balance never goes below zero; exactly
--     once per purchase (unique index); the business owners get a notification
--   • billing_payments.status may now be 'voided' (the platform admin hides a payment from revenue without deleting it)
--   • billing_payments.refunded_at / voided_at / void_reason for the record
-- Nothing is dropped; existing rows keep their values.

alter table public.credit_purchases drop constraint if exists credit_purchases_status_check;
alter table public.credit_purchases add constraint credit_purchases_status_check check (status in ('pending', 'paid', 'canceled', 'refunded'));

alter table public.billing_payments drop constraint if exists billing_payments_status_check;
alter table public.billing_payments add constraint billing_payments_status_check check (status in ('paid', 'refunded', 'pending', 'failed', 'voided'));
alter table public.billing_payments add column if not exists refunded_at timestamptz;
alter table public.billing_payments add column if not exists voided_at timestamptz;
alter table public.billing_payments add column if not exists void_reason text check (void_reason is null or char_length(void_reason) <= 300);

create unique index if not exists credit_ledger_refund_once on public.credit_ledger (purchase_id) where reason = 'refund';

create or replace function public.revoke_credit_purchase(p_purchase uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cp public.credit_purchases;
  k text;
  left_now bigint;
  take int;
begin
  select * into cp from public.credit_purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if cp.status = 'refunded' then return jsonb_build_object('ok', true, 'already', true); end if;
  if cp.status <> 'paid' then return jsonb_build_object('ok', false, 'error', 'not_paid'); end if;
  k := case when cp.pack like 'min\_%' then 'voice' else 'ai' end;
  select greatest(0, coalesce(sum(delta), 0)) into left_now from public.credit_ledger where organization_id = cp.organization_id and kind = k;
  take := least(cp.credits::bigint, left_now)::int;
  update public.credit_purchases set status = 'refunded' where id = cp.id;
  if take > 0 then
    insert into public.credit_ledger (organization_id, kind, delta, reason, purchase_id, note)
    values (cp.organization_id, k, -take, 'refund', cp.id, left(coalesce(p_note, 'payment refunded'), 300))
    on conflict do nothing;
  end if;
  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  select cp.organization_id, m.user_id, 'billing', 'credits.refundedNotification', jsonb_build_object('credits', take), '/billing'
    from public.organization_members m
   where m.organization_id = cp.organization_id and m.role in ('agency_owner', 'owner', 'admin');
  return jsonb_build_object('ok', true, 'credits', take, 'kind', k);
end;
$$;
revoke all on function public.revoke_credit_purchase(uuid, text) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.revoke_credit_purchase(uuid, text) to service_role';
exception when undefined_object then null; end $$;
