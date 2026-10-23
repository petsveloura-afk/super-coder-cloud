-- Platform upgrade (wave 19) — online stores (Shopify / WooCommerce), abandoned carts,
-- Google reviews, and the AI agents' work log. ADDITIVE only.

-- ------------------------------------------------- store orders
create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('shopify', 'woocommerce', 'other')),
  external_id text not null check (char_length(external_id) <= 120),
  number text check (number is null or char_length(number) <= 60),
  contact_id uuid,
  email citext,
  phone text check (phone is null or char_length(phone) <= 40),
  customer_name text check (customer_name is null or char_length(customer_name) <= 160),
  total numeric(14, 2) not null default 0 check (total >= 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'open' check (char_length(status) <= 40),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 60000),
  placed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists store_orders_org on public.store_orders (organization_id, placed_at desc);
create index if not exists store_orders_contact on public.store_orders (contact_id);
alter table public.store_orders enable row level security;
drop policy if exists store_orders_read on public.store_orders;
create policy store_orders_read on public.store_orders for select to authenticated
  using (public.has_permission(organization_id, 'finance.read') or public.has_permission(organization_id, 'contacts.read'));
revoke insert, update, delete on public.store_orders from anon, authenticated;
grant select on public.store_orders to authenticated;

-- ------------------------------------------------- abandoned checkouts
create table if not exists public.store_carts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('shopify', 'woocommerce', 'other')),
  external_id text not null check (char_length(external_id) <= 120),
  contact_id uuid,
  email citext,
  phone text check (phone is null or char_length(phone) <= 40),
  customer_name text check (customer_name is null or char_length(customer_name) <= 160),
  total numeric(14, 2) not null default 0 check (total >= 0),
  currency text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  checkout_url text check (checkout_url is null or (checkout_url ~ '^https://' and char_length(checkout_url) <= 1500)),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 60000),
  status text not null default 'open' check (status in ('open', 'reminded', 'recovered', 'expired')),
  reminded_at timestamptz,
  recovered_order_id uuid references public.store_orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists store_carts_open on public.store_carts (status, created_at);
alter table public.store_carts enable row level security;
drop policy if exists store_carts_read on public.store_carts;
create policy store_carts_read on public.store_carts for select to authenticated
  using (public.has_permission(organization_id, 'finance.read') or public.has_permission(organization_id, 'contacts.read'));
revoke insert, update, delete on public.store_carts from anon, authenticated;
grant select on public.store_carts to authenticated;

-- contact for a store customer: by e-mail, then phone; created when new (source = the store)
create or replace function public.store_contact(p_org uuid, p_source text, p_email text, p_phone text, p_name text, p_consent boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  cid uuid;
  em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  ph text := public.norm_phone(p_phone);
  nm text := left(coalesce(nullif(btrim(p_name), ''), split_part(coalesce(em, ''), '@', 1), ph, 'Customer'), 120);
begin
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em := null; end if;
  if em is not null then select id into cid from public.contacts where organization_id = p_org and email = em::citext order by created_at limit 1; end if;
  if cid is null and ph is not null then
    select id into cid from public.contacts where organization_id = p_org and public.norm_phone(phone) = ph order by created_at limit 1;
  end if;
  if cid is null and (em is not null or ph is not null) then
    begin
      insert into public.contacts (organization_id, first_name, last_name, email, phone, source, marketing_consent)
      values (p_org, left(split_part(nm, ' ', 1), 80), left(btrim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), 80), em, ph, left(p_source, 40), coalesce(p_consent, false))
      returning id into cid;
    exception when others then cid := null; -- plan limit: keep the order anyway
    end;
  end if;
  return cid;
end;
$fn$;
revoke all on function public.store_contact(uuid, text, text, text, text, boolean) from public, anon, authenticated;

-- an order (webhook): stored once, the contact becomes a customer, the cart is recovered, event "order.created"
create or replace function public.record_store_order(p_org uuid, p_source text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  oid uuid;
  cid uuid;
  was_update boolean;
  ext text := left(coalesce(p_order ->> 'id', ''), 120);
  tot numeric := greatest(0, coalesce(nullif(p_order ->> 'total', '')::numeric, 0));
  cur text := upper(coalesce(nullif(p_order ->> 'currency', ''), 'ILS'));
begin
  if p_source not in ('shopify', 'woocommerce', 'other') or ext = '' then raise exception 'invalid_order' using errcode = '22023'; end if;
  if cur !~ '^[A-Z]{3}$' then cur := 'ILS'; end if;
  cid := public.store_contact(p_org, p_source, p_order ->> 'email', p_order ->> 'phone', p_order ->> 'name', coalesce((p_order ->> 'consent')::boolean, false));
  insert into public.store_orders (organization_id, source, external_id, number, contact_id, email, phone, customer_name, total, currency, status, items, placed_at)
  values (p_org, p_source, ext, left(p_order ->> 'number', 60), cid, nullif(lower(p_order ->> 'email'), '')::citext, left(p_order ->> 'phone', 40), left(p_order ->> 'name', 160),
          tot, cur, left(coalesce(p_order ->> 'status', 'paid'), 40),
          case when jsonb_typeof(p_order -> 'items') = 'array' then p_order -> 'items' else '[]'::jsonb end,
          coalesce(nullif(p_order ->> 'placed_at', '')::timestamptz, now()))
  on conflict (organization_id, source, external_id) do update set status = excluded.status, total = excluded.total
  returning id, (xmax <> 0) into oid, was_update;
  if was_update then
    return jsonb_build_object('ok', true, 'id', oid, 'updated', true);
  end if;
  if cid is not null then
    update public.contacts set status = 'customer' where id = cid and status in ('lead', 'qualified');
  end if;
  update public.store_carts set status = 'recovered', recovered_order_id = oid, updated_at = now()
   where organization_id = p_org and status in ('open', 'reminded')
     and ((cid is not null and contact_id = cid) or (p_order ->> 'email' is not null and email = lower(p_order ->> 'email')::citext))
     and created_at > now() - interval '14 days';
  perform public.emit_event(p_org, 'order.created', case when cid is null then 'order' else 'contact' end, coalesce(cid, oid),
    jsonb_build_object('order_id', oid, 'source', p_source, 'number', p_order ->> 'number', 'total', tot, 'currency', cur, 'contact_id', cid));
  return jsonb_build_object('ok', true, 'id', oid, 'contact_id', cid);
end;
$fn$;
revoke all on function public.record_store_order(uuid, text, jsonb) from public, anon, authenticated;

-- a checkout that was started (webhook): stored / updated; the cron emits "cart.abandoned" after a quiet hour
create or replace function public.record_store_cart(p_org uuid, p_source text, p_cart jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  id_ uuid;
  cid uuid;
  ext text := left(coalesce(p_cart ->> 'id', ''), 120);
  url text := nullif(p_cart ->> 'checkout_url', '');
  cur text := upper(coalesce(nullif(p_cart ->> 'currency', ''), 'ILS'));
begin
  if p_source not in ('shopify', 'woocommerce', 'other') or ext = '' then raise exception 'invalid_cart' using errcode = '22023'; end if;
  if url is not null and url !~ '^https://' then url := null; end if;
  if cur !~ '^[A-Z]{3}$' then cur := 'ILS'; end if;
  if nullif(p_cart ->> 'email', '') is null and nullif(p_cart ->> 'phone', '') is null then
    return jsonb_build_object('ok', false, 'reason', 'no_contact_details');
  end if;
  cid := public.store_contact(p_org, p_source, p_cart ->> 'email', p_cart ->> 'phone', p_cart ->> 'name', coalesce((p_cart ->> 'consent')::boolean, false));
  insert into public.store_carts (organization_id, source, external_id, contact_id, email, phone, customer_name, total, currency, checkout_url, items)
  values (p_org, p_source, ext, cid, nullif(lower(p_cart ->> 'email'), '')::citext, left(p_cart ->> 'phone', 40), left(p_cart ->> 'name', 160),
          greatest(0, coalesce(nullif(p_cart ->> 'total', '')::numeric, 0)), cur, left(url, 1500),
          case when jsonb_typeof(p_cart -> 'items') = 'array' then p_cart -> 'items' else '[]'::jsonb end)
  on conflict (organization_id, source, external_id) do update
     set total = excluded.total, items = excluded.items, checkout_url = coalesce(excluded.checkout_url, public.store_carts.checkout_url),
         contact_id = coalesce(public.store_carts.contact_id, excluded.contact_id), updated_at = now()
   where public.store_carts.status = 'open'
  returning id into id_;
  return jsonb_build_object('ok', true, 'id', id_, 'contact_id', cid);
end;
$fn$;
revoke all on function public.record_store_cart(uuid, text, jsonb) from public, anon, authenticated;

-- carts quiet for an hour (and no order since) → "cart.abandoned" once (automations + the collections agent)
create or replace function public.claim_abandoned_carts(p_limit int default 30)
returns setof public.store_carts
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  c public.store_carts;
begin
  for c in
    update public.store_carts s set status = 'reminded', reminded_at = now(), updated_at = now()
     where s.id in (select id from public.store_carts where status = 'open' and updated_at < now() - interval '1 hour'
                     and created_at > now() - interval '7 days' order by updated_at limit greatest(1, least(p_limit, 100)) for update skip locked)
    returning s.*
  loop
    perform public.emit_event(c.organization_id, 'cart.abandoned', case when c.contact_id is null then 'cart' else 'contact' end, coalesce(c.contact_id, c.id),
      jsonb_build_object('cart_id', c.id, 'source', c.source, 'total', c.total, 'currency', c.currency, 'checkout_url', c.checkout_url, 'contact_id', c.contact_id));
    return next c;
  end loop;
  update public.store_carts set status = 'expired', updated_at = now() where status in ('open', 'reminded') and created_at < now() - interval '14 days';
end;
$fn$;
revoke all on function public.claim_abandoned_carts(int) from public, anon, authenticated;

-- ------------------------------------------------- reviews (Google Business Profile; more sources later)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null default 'google' check (source in ('google', 'facebook', 'other')),
  location text check (location is null or char_length(location) <= 300),
  external_id text not null check (char_length(external_id) <= 300),
  author text check (author is null or char_length(author) <= 160),
  rating int check (rating is null or rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 8000),
  reply text check (reply is null or char_length(reply) <= 4000),
  replied_at timestamptz,
  ai_draft text check (ai_draft is null or char_length(ai_draft) <= 4000),
  status text not null default 'new' check (status in ('new', 'drafted', 'replied', 'auto_replied', 'ignored')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index if not exists reviews_org on public.reviews (organization_id, status, reviewed_at desc);
alter table public.reviews enable row level security;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews for update to authenticated
  using (public.has_permission(organization_id, 'inbox.reply')) with check (public.has_permission(organization_id, 'inbox.reply'));
revoke insert, delete on public.reviews from anon, authenticated;
grant select, update on public.reviews to authenticated;

create or replace function public.record_review(p_org uuid, p_source text, p_location text, p_external text, p_author text, p_rating int, p_body text, p_reply text, p_reviewed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  rid uuid;
begin
  insert into public.reviews (organization_id, source, location, external_id, author, rating, body, reply, replied_at, status, reviewed_at)
  values (p_org, coalesce(p_source, 'google'), left(p_location, 300), left(p_external, 300), left(p_author, 160),
          case when p_rating between 1 and 5 then p_rating end, left(coalesce(p_body, ''), 8000), left(p_reply, 4000),
          case when p_reply is not null then now() end, case when p_reply is not null then 'replied' else 'new' end, p_reviewed_at)
  on conflict (organization_id, source, external_id) do nothing
  returning id into rid;
  if rid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_reply is null then
    perform public.emit_event(p_org, 'review.received', 'review', rid,
      jsonb_build_object('source', p_source, 'rating', p_rating, 'author', p_author, 'text', left(coalesce(p_body, ''), 1000)));
  end if;
  return jsonb_build_object('ok', true, 'id', rid);
end;
$fn$;
revoke all on function public.record_review(uuid, text, text, text, text, int, text, text, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------- the AI agents' work log (agents hub)
create table if not exists public.agent_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent text not null check (agent in ('marketing', 'sales_manager', 'analyst', 'collections', 'social', 'reviews', 'stores')),
  summary text not null check (char_length(summary) <= 4000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 60000),
  actions int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists agent_runs_org on public.agent_runs (organization_id, agent, created_at desc);
alter table public.agent_runs enable row level security;
drop policy if exists agent_runs_read on public.agent_runs;
create policy agent_runs_read on public.agent_runs for select to authenticated using (public.is_org_member(organization_id));
revoke insert, update, delete on public.agent_runs from anon, authenticated;
grant select on public.agent_runs to authenticated;

-- which agents a business switched on (+ their settings)
create table if not exists public.agent_settings (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent text not null check (agent in ('marketing', 'sales_manager', 'analyst', 'collections')),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 20000),
  last_run_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, agent)
);
alter table public.agent_settings enable row level security;
drop policy if exists agent_settings_read on public.agent_settings;
create policy agent_settings_read on public.agent_settings for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists agent_settings_write on public.agent_settings;
create policy agent_settings_write on public.agent_settings for all to authenticated
  using (public.has_permission(organization_id, 'ai.manage')) with check (public.has_permission(organization_id, 'ai.manage'));
grant select, insert, update on public.agent_settings to authenticated;

-- due agents (cron): enabled, and not run in the last p_minutes
create or replace function public.claim_due_agents(p_agent text, p_minutes int, p_limit int default 25)
returns table (organization_id uuid, config jsonb)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.agent_settings s set last_run_at = now()
   where (s.organization_id, s.agent) in (
     select a.organization_id, a.agent from public.agent_settings a
      where a.agent = p_agent and a.enabled and (a.last_run_at is null or a.last_run_at < now() - make_interval(mins => greatest(5, p_minutes)))
      order by a.last_run_at nulls first limit greatest(1, least(p_limit, 200)) for update skip locked)
  returning s.organization_id, s.config;
$fn$;
revoke all on function public.claim_due_agents(text, int, int) from public, anon, authenticated;

-- overdue invoices for the collections agent (balance > 0, past due, reminders spaced by p_days)
create or replace function public.overdue_invoices(p_org uuid, p_days int default 3, p_limit int default 30)
returns table (id uuid, number text, contact_id uuid, total numeric, balance numeric, currency text, due_date date, days_overdue int, reminders int, public_token text)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.id, d.number::text, d.contact_id, d.total, greatest(0, d.total - d.amount_paid), d.currency::text, d.due_date,
         (current_date - d.due_date)::int,
         (select count(*)::int from public.activities a where a.organization_id = d.organization_id and a.type = 'invoice.reminded' and (a.payload ->> 'document_id') = d.id::text),
         d.public_token::text
    from public.documents d
   where d.organization_id = p_org and d.kind = 'invoice' and d.status in ('sent', 'accepted') and d.due_date is not null
     and d.due_date < current_date and d.total - d.amount_paid > 0.009 and d.contact_id is not null
     and not exists (select 1 from public.activities a where a.organization_id = d.organization_id and a.type = 'invoice.reminded'
                      and (a.payload ->> 'document_id') = d.id::text and a.created_at > now() - make_interval(days => greatest(1, p_days)))
   order by d.due_date limit greatest(1, least(p_limit, 100));
$fn$;
revoke all on function public.overdue_invoices(uuid, int, int) from public, anon, authenticated;

-- deals with no activity for p_days (the sales manager agent)
create or replace function public.stuck_deals(p_org uuid, p_days int default 7, p_limit int default 30)
returns table (id uuid, title text, value numeric, stage_name text, owner_id uuid, contact_id uuid, days_quiet int)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select d.id, d.title, d.value, s.name, d.owner_id, d.contact_id,
         extract(day from now() - greatest(d.updated_at, coalesce((select max(a.created_at) from public.activities a where a.organization_id = d.organization_id and (a.deal_id = d.id or (d.contact_id is not null and a.contact_id = d.contact_id))), d.updated_at)))::int
    from public.deals d
    left join public.pipeline_stages s on s.id = d.stage_id
   where d.organization_id = p_org and d.status = 'open'
     and greatest(d.updated_at, coalesce((select max(a.created_at) from public.activities a where a.organization_id = d.organization_id and (a.deal_id = d.id or (d.contact_id is not null and a.contact_id = d.contact_id))), d.updated_at)) < now() - make_interval(days => greatest(1, p_days))
   order by d.value desc nulls last limit greatest(1, least(p_limit, 100));
$fn$;
revoke all on function public.stuck_deals(uuid, int, int) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.store_orders, public.store_carts, public.reviews, public.agent_runs, public.agent_settings to service_role';
    execute 'grant execute on function public.store_contact(uuid, text, text, text, text, boolean), public.record_store_order(uuid, text, jsonb),
      public.record_store_cart(uuid, text, jsonb), public.claim_abandoned_carts(int),
      public.record_review(uuid, text, text, text, text, int, text, text, timestamptz),
      public.claim_due_agents(text, int, int), public.overdue_invoices(uuid, int, int), public.stuck_deals(uuid, int, int) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
