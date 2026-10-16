-- ============================================================================
-- SUPER CODER CLOUD — 0019 Business: support tickets (+ customer portal),
-- finance (quotes, transaction invoices, payments, products), landing pages,
-- platform-admin RPCs. Additive only.
-- Note: documents are "quotes" and "transaction invoices" (חשבון עסקה /
-- דרישת תשלום) — NOT tax invoices; a licensed invoicing provider is required
-- for חשבונית מס in Israel.
-- ============================================================================

-- ================================================================= tickets
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number int not null,
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  channel text not null default 'manual' check (channel in ('manual', 'portal', 'email', 'inbox', 'form', 'api')),
  contact_id uuid,
  assignee_id uuid references auth.users (id) on delete set null,
  public_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  sla_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists tickets_org_status_idx on public.tickets (organization_id, status, updated_at desc);

create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ticket_id uuid not null,
  author_type text not null check (author_type in ('agent', 'customer', 'system')),
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, ticket_id) references public.tickets (organization_id, id) on delete cascade
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

-- per-organization counters for human-friendly numbers (#1001, Q-1001, I-1001)
create table if not exists public.org_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('ticket', 'quote', 'invoice')),
  last_value int not null default 1000,
  primary key (organization_id, kind)
);
alter table public.org_counters enable row level security;
revoke all on public.org_counters from anon, authenticated;

create or replace function public.next_number(p_org uuid, p_kind text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v int;
begin
  insert into public.org_counters (organization_id, kind) values (p_org, p_kind) on conflict do nothing;
  update public.org_counters set last_value = last_value + 1 where organization_id = p_org and kind = p_kind returning last_value into v;
  return v;
end;
$$;
revoke execute on function public.next_number(uuid, text) from public, anon, authenticated;

create or replace function public.tickets_before()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.number := public.next_number(new.organization_id, 'ticket');
  end if;
  if tg_op = 'INSERT' or new.priority is distinct from old.priority then
    new.sla_due_at := coalesce(case when tg_op = 'INSERT' then now() else old.created_at end, now())
      + case new.priority when 'urgent' then interval '4 hours' when 'high' then interval '8 hours' when 'normal' then interval '24 hours' else interval '72 hours' end;
  end if;
  if new.status in ('resolved', 'closed') and (tg_op = 'INSERT' or old.status not in ('resolved', 'closed')) then
    new.resolved_at := now();
  elsif new.status in ('open', 'pending') then
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists tickets_before on public.tickets;
create trigger tickets_before before insert or update on public.tickets for each row execute function public.tickets_before();

create or replace function public.tickets_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_event(new.organization_id, 'ticket.created', case when new.contact_id is null then 'ticket' else 'contact' end, new.contact_id,
    jsonb_build_object('ticket_id', new.id, 'number', new.number, 'subject', new.subject, 'priority', new.priority, 'channel', new.channel, 'contact_id', new.contact_id));
  return null;
end;
$$;
drop trigger if exists tickets_after_insert on public.tickets;
create trigger tickets_after_insert after insert on public.tickets for each row execute function public.tickets_after_insert();

-- agent replies stamp first response and wait for the customer; customer replies reopen
create or replace function public.ticket_messages_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.author_type = 'agent' and not new.internal then
    update public.tickets
       set first_response_at = coalesce(first_response_at, now()),
           status = case when status = 'open' then 'pending' else status end
     where id = new.ticket_id;
  elsif new.author_type = 'customer' then
    update public.tickets set status = 'open' where id = new.ticket_id and status <> 'open';
  else
    update public.tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return null;
end;
$$;
drop trigger if exists ticket_messages_after on public.ticket_messages;
create trigger ticket_messages_after after insert on public.ticket_messages for each row execute function public.ticket_messages_after();

-- ================================================================= finance
create table if not exists public.finance_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  business_name text check (business_name is null or char_length(business_name) <= 160),
  business_id text check (business_id is null or char_length(business_id) <= 40),
  address text check (address is null or char_length(address) <= 300),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  default_tax_rate numeric(5, 2) not null default 18 check (default_tax_rate between 0 and 100),
  quote_valid_days int not null default 14 check (quote_valid_days between 1 and 365),
  payment_terms_days int not null default 30 check (payment_terms_days between 0 and 365),
  payment_instructions text check (payment_instructions is null or char_length(payment_instructions) <= 2000),
  default_notes text check (default_notes is null or char_length(default_notes) <= 2000),
  stripe_secret_enc text,
  stripe_webhook_secret_enc text,
  stripe_webhook_token text unique default encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 1000),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  tax_rate numeric(5, 2) check (tax_rate is null or tax_rate between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('quote', 'invoice')),
  number int not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'paid', 'void')),
  contact_id uuid,
  company_id uuid,
  deal_id uuid,
  title text check (title is null or char_length(title) <= 200),
  issue_date date not null default current_date,
  due_date date,
  currency char(3) not null default 'ILS',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_paid numeric(14, 2) not null default 0,
  notes text check (notes is null or char_length(notes) <= 4000),
  payment_url text check (payment_url is null or (payment_url ~ '^https://\S+$' and char_length(payment_url) <= 2000)),
  public_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  source_document_id uuid,
  accepted_at timestamptz,
  accepted_by_name text check (accepted_by_name is null or char_length(accepted_by_name) <= 120),
  paid_at timestamptz,
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind, number),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete set null (company_id),
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete set null (deal_id)
);
create index if not exists documents_org_kind_idx on public.documents (organization_id, kind, created_at desc);

create table if not exists public.document_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  position int not null default 0,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate numeric(5, 2) not null default 18 check (tax_rate between 0 and 100),
  line_total numeric(14, 2) not null default 0,
  foreign key (organization_id, document_id) references public.documents (organization_id, id) on delete cascade
);
create index if not exists document_lines_doc_idx on public.document_lines (document_id, position);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null default 'transfer' check (method in ('cash', 'transfer', 'card', 'check', 'bit', 'paybox', 'stripe', 'other')),
  reference text check (reference is null or char_length(reference) <= 200),
  paid_at timestamptz not null default now(),
  external_id text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, document_id) references public.documents (organization_id, id) on delete cascade
);

create or replace function public.documents_before()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.number := public.next_number(new.organization_id, new.kind);
  elsif new.kind <> old.kind then
    raise exception 'kind_immutable' using errcode = '22023';
  end if;
  if new.kind = 'quote' and new.status in ('paid') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if new.kind = 'invoice' and new.status in ('accepted', 'declined', 'expired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'sent') then
    new.sent_at := coalesce(new.sent_at, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists documents_before on public.documents;
create trigger documents_before before insert or update on public.documents for each row execute function public.documents_before();

-- line totals (net of discount, before tax) and document totals
create or replace function public.document_lines_before()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.line_total := round(new.quantity * new.unit_price * (1 - new.discount_pct / 100), 2);
  return new;
end;
$$;
drop trigger if exists document_lines_before on public.document_lines;
create trigger document_lines_before before insert or update on public.document_lines for each row execute function public.document_lines_before();

create or replace function public.recalc_document(p_doc uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.documents d
     set subtotal = coalesce(x.sub, 0),
         tax_total = coalesce(x.tax, 0),
         total = coalesce(x.sub, 0) + coalesce(x.tax, 0)
    from (select sum(line_total) as sub, round(sum(line_total * tax_rate / 100), 2) as tax
            from public.document_lines where document_id = p_doc) x
   where d.id = p_doc;
end;
$$;
revoke execute on function public.recalc_document(uuid) from public, anon, authenticated;

create or replace function public.document_lines_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recalc_document(coalesce(new.document_id, old.document_id));
  return null;
end;
$$;
drop trigger if exists document_lines_after on public.document_lines;
create trigger document_lines_after after insert or update or delete on public.document_lines for each row execute function public.document_lines_after();

-- payments update the paid amount; fully paid invoices become "paid" and fire invoice.paid
create or replace function public.payments_after()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
  paid numeric;
begin
  select coalesce(sum(amount), 0) into paid from public.payments where document_id = coalesce(new.document_id, old.document_id);
  update public.documents set amount_paid = paid where id = coalesce(new.document_id, old.document_id) returning * into d;
  if d.kind = 'invoice' and d.total > 0 and paid >= d.total and d.status <> 'paid' then
    update public.documents set status = 'paid', paid_at = now() where id = d.id;
    perform public.emit_event(d.organization_id, 'invoice.paid', case when d.contact_id is null then 'document' else 'contact' end, d.contact_id,
      jsonb_build_object('document_id', d.id, 'number', d.number, 'total', d.total, 'currency', d.currency, 'contact_id', d.contact_id, 'deal_id', d.deal_id));
    insert into public.notifications (organization_id, user_id, kind, title_key, params)
    select d.organization_id, m.user_id, 'finance', 'finance.paidNotification', jsonb_build_object('number', d.number, 'total', d.total::text, 'currency', d.currency)
      from public.organization_members m where m.organization_id = d.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager');
  elsif d.kind = 'invoice' and paid < d.total and d.status = 'paid' then
    update public.documents set status = 'sent', paid_at = null where id = d.id;
  end if;
  return null;
end;
$$;
drop trigger if exists payments_after on public.payments;
create trigger payments_after after insert or update or delete on public.payments for each row execute function public.payments_after();

-- ================================================================ websites
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  theme jsonb not null default '{"accent":"#3366E6","mode":"dark"}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 40),
  visits int not null default 0,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- ===================================================================== RLS
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.finance_settings enable row level security;
alter table public.products enable row level security;
alter table public.documents enable row level security;
alter table public.document_lines enable row level security;
alter table public.payments enable row level security;
alter table public.sites enable row level security;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('tickets',          'tickets.read',  'tickets.write',  'tickets.write'),
      ('products',         'finance.read',  'finance.write',  'finance.write'),
      ('documents',        'finance.read',  'finance.write',  'finance.write'),
      ('document_lines',   'finance.read',  'finance.write',  'finance.write'),
      ('payments',         'finance.read',  'finance.write',  'finance.write'),
      ('finance_settings', 'finance.read',  'finance.write',  'finance.write'),
      ('sites',            'websites.manage', 'websites.manage', 'websites.manage')
    ) as v(tbl, r, w, d)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(organization_id, %L))', spec.tbl || '_select', spec.tbl, spec.r);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(organization_id, %L))', spec.tbl || '_insert', spec.tbl, spec.w);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(organization_id, %L)) with check (public.has_permission(organization_id, %L))', spec.tbl || '_update', spec.tbl, spec.w, spec.w);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(organization_id, %L))', spec.tbl || '_delete', spec.tbl, spec.d);
  end loop;
end $$;
create policy ticket_messages_select on public.ticket_messages for select to authenticated using (public.has_permission(organization_id, 'tickets.read'));
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
  with check (public.has_permission(organization_id, 'tickets.write') and author_type = 'agent' and author_id = auth.uid());

grant select, insert, update, delete on public.tickets, public.products, public.documents, public.document_lines, public.payments, public.sites to authenticated;
grant select, insert on public.ticket_messages to authenticated;
-- finance_settings: Stripe ciphertext columns are never readable by users
grant select (organization_id, business_name, business_id, address, phone, email, default_tax_rate, quote_valid_days, payment_terms_days, payment_instructions, default_notes, stripe_webhook_token, updated_at)
  on public.finance_settings to authenticated;
grant insert, update on public.finance_settings to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.tickets, public.ticket_messages, public.finance_settings, public.products, public.documents, public.document_lines, public.payments, public.sites to service_role;
  end if;
end $$;

-- whether online card payment (org's own Stripe) is configured — without exposing secrets
create or replace function public.finance_stripe_ready(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission(p_org, 'finance.read')
     and exists (select 1 from public.finance_settings where organization_id = p_org and stripe_secret_enc is not null and stripe_webhook_secret_enc is not null);
$$;
revoke execute on function public.finance_stripe_ready(uuid) from public, anon;
grant execute on function public.finance_stripe_ready(uuid) to authenticated;

-- ======================================================= public: support
create or replace function public.create_public_ticket(p_org_slug text, p_name text, p_email text, p_subject text, p_body text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  o public.organizations;
  cid uuid;
  t public.tickets;
begin
  select * into o from public.organizations where slug = p_org_slug;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.public_rate_limit('ticket:' || o.id || ':' || coalesce(p_meta ->> 'ip_hash', 'anon'), 5, 600) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if btrim(coalesce(p_name, '')) = '' or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or btrim(coalesce(p_subject, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'support.detailsRequired');
  end if;
  begin
    cid := public.upsert_public_contact(o.id, p_name, p_email, null, 'website', false, '{}'::jsonb);
  exception when others then
    cid := null;
  end;
  insert into public.tickets (organization_id, subject, channel, contact_id)
  values (o.id, left(btrim(p_subject), 200), 'portal', cid)
  returning * into t;
  insert into public.ticket_messages (organization_id, ticket_id, author_type, body)
  values (o.id, t.id, 'customer', left(btrim(p_body), 20000));
  insert into public.notifications (organization_id, user_id, kind, title_key, params)
  select o.id, m.user_id, 'ticket', 'support.newTicketNotification', jsonb_build_object('number', t.number, 'subject', t.subject)
    from public.organization_members m
   where m.organization_id = o.id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'support');
  return jsonb_build_object('ok', true, 'number', t.number, 'token', t.public_token, 'email', lower(p_email));
end;
$$;

create or replace function public.get_public_ticket(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'number', t.number,
    'subject', t.subject,
    'status', t.status,
    'org', o.name,
    'created_at', t.created_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('author', m.author_type, 'body', m.body, 'at', m.created_at,
                                          'agent', case when m.author_type = 'agent' then coalesce(p.full_name, '') end) order by m.created_at)
        from public.ticket_messages m left join public.profiles p on p.id = m.author_id
       where m.ticket_id = t.id and not m.internal and m.author_type <> 'system'), '[]'::jsonb)
  )
  from public.tickets t join public.organizations o on o.id = t.organization_id
  where t.public_token = p_token;
$$;

create or replace function public.reply_public_ticket(p_token text, p_body text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tickets;
begin
  select * into t from public.tickets where public_token = p_token;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if t.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'support.ticketClosed');
  end if;
  if not public.public_rate_limit('ticket-reply:' || t.id || ':' || coalesce(p_meta ->> 'ip_hash', 'anon'), 10, 600) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if btrim(coalesce(p_body, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'validation.required');
  end if;
  insert into public.ticket_messages (organization_id, ticket_id, author_type, body)
  values (t.organization_id, t.id, 'customer', left(btrim(p_body), 20000));
  if t.assignee_id is not null then
    insert into public.notifications (organization_id, user_id, kind, title_key, params)
    values (t.organization_id, t.assignee_id, 'ticket', 'support.replyNotification', jsonb_build_object('number', t.number));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ======================================================= public: finance
create or replace function public.get_public_document(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  select * into d from public.documents where public_token = p_token and status <> 'draft';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'kind', d.kind, 'number', d.number, 'status', d.status, 'title', d.title,
    'issue_date', d.issue_date, 'due_date', d.due_date, 'currency', d.currency,
    'subtotal', d.subtotal, 'tax_total', d.tax_total, 'total', d.total, 'amount_paid', d.amount_paid,
    'notes', d.notes, 'payment_url', d.payment_url, 'accepted_at', d.accepted_at, 'accepted_by_name', d.accepted_by_name,
    'expired', d.kind = 'quote' and d.due_date is not null and d.due_date < current_date and d.status = 'sent',
    'org', (select jsonb_build_object('name', o.name) from public.organizations o where o.id = d.organization_id),
    'seller', (select to_jsonb(s) - 'stripe_secret_enc' - 'stripe_webhook_secret_enc' - 'stripe_webhook_token' - 'organization_id'
                 from public.finance_settings s where s.organization_id = d.organization_id),
    'online_payment', exists (select 1 from public.finance_settings s where s.organization_id = d.organization_id and s.stripe_secret_enc is not null and s.stripe_webhook_secret_enc is not null),
    'customer', (select jsonb_build_object('name', btrim(c.first_name || ' ' || c.last_name), 'email', c.email, 'phone', c.phone, 'company', c.company_name)
                   from public.contacts c where c.id = d.contact_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price,
                                                          'discount_pct', l.discount_pct, 'tax_rate', l.tax_rate, 'line_total', l.line_total) order by l.position)
                         from public.document_lines l where l.document_id = d.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.accept_public_quote(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  if btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'finance.nameRequired');
  end if;
  update public.documents
     set status = 'accepted', accepted_at = now(), accepted_by_name = left(btrim(p_name), 120)
   where public_token = p_token and kind = 'quote' and status = 'sent' and (due_date is null or due_date >= current_date)
  returning * into d;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'finance.cannotAccept');
  end if;
  insert into public.notifications (organization_id, user_id, kind, title_key, params)
  select d.organization_id, m.user_id, 'finance', 'finance.acceptedNotification', jsonb_build_object('number', d.number, 'name', d.accepted_by_name)
    from public.organization_members m where m.organization_id = d.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'sales');
  if d.contact_id is not null then
    insert into public.activities (organization_id, contact_id, deal_id, type, payload)
    values (d.organization_id, d.contact_id, d.deal_id, 'quote.accepted', jsonb_build_object('document_id', d.id, 'number', d.number, 'total', d.total));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- service role: online payment confirmed by the org's own Stripe webhook
create or replace function public.record_online_payment(p_token text, p_amount numeric, p_external_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  select * into d from public.documents where public_token = p_token and kind = 'invoice';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.payments (organization_id, document_id, amount, method, reference, external_id)
  values (d.organization_id, d.id, p_amount, 'stripe', 'Stripe ' || p_external_id, p_external_id)
  on conflict (external_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- ======================================================== public: sites
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('name', s.name, 'theme', s.theme, 'seo', s.seo, 'blocks', s.blocks, 'org', o.name, 'org_slug', o.slug)
    from public.sites s join public.organizations o on o.id = s.organization_id
   where s.slug = p_slug and s.status = 'published';
$$;

create or replace function public.track_site_visit(p_slug text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sid uuid;
begin
  select id into sid from public.sites where slug = p_slug and status = 'published';
  if sid is null then return; end if;
  -- one count per visitor per site per day
  if public.public_rate_limit('visit:' || sid || ':' || coalesce(p_meta ->> 'ip_hash', 'anon'), 1, 86400) then
    update public.sites set visits = visits + 1 where id = sid;
  end if;
end;
$$;

-- ================================================== platform administration
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'organizations', (select count(*) from public.organizations),
    'users', (select count(*) from public.profiles),
    'new_orgs_30d', (select count(*) from public.organizations where created_at > now() - interval '30 days'),
    'contacts', (select count(*) from public.contacts),
    'plans', coalesce((select jsonb_object_agg(plan, n) from (select plan, count(*) n from public.organizations group by plan) x), '{}'::jsonb),
    'ai_credits_30d', (select coalesce(sum(credits), 0) from public.ai_usage where created_at > now() - interval '30 days' and status = 'ok'),
    'jobs_dead', (select count(*) from public.jobs where status = 'dead'),
    'jobs_queued', (select count(*) from public.jobs where status = 'queued'),
    'messages_30d', (select count(*) from public.messages where created_at > now() - interval '30 days')
  );
end;
$$;

create or replace function public.platform_organizations(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, slug text, plan text, is_demo boolean, created_at timestamptz, members bigint, contacts bigint, owner_email text)
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
  select o.id, o.name, o.slug, o.plan::text, o.is_demo, o.created_at,
         (select count(*) from public.organization_members m where m.organization_id = o.id),
         (select count(*) from public.contacts c where c.organization_id = o.id),
         (select p.email::text from public.organization_members m join public.profiles p on p.id = m.user_id
           where m.organization_id = o.id and m.role in ('owner', 'agency_owner') order by m.created_at limit 1)
    from public.organizations o
   where p_search is null or p_search = '' or o.name ilike '%' || p_search || '%' or o.slug ilike '%' || p_search || '%'
   order by o.created_at desc
   limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
end;
$$;

create or replace function public.platform_set_flag(p_key text, p_org uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.feature_flags (key, organization_id, enabled, updated_at)
  values (p_key, p_org, p_enabled, now())
  on conflict (key, organization_id) do update set enabled = excluded.enabled, updated_at = now();
end;
$$;

-- ================================================================== grants
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_public_ticket(text, text, text, text, text, jsonb)',
    'public.get_public_ticket(text)',
    'public.reply_public_ticket(text, text, jsonb)',
    'public.get_public_document(text)',
    'public.accept_public_quote(text, text)',
    'public.get_public_site(text)',
    'public.track_site_visit(text, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array['public.platform_overview()', 'public.platform_organizations(text, int, int)', 'public.platform_set_flag(text, uuid, boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.record_online_payment(text, numeric, text) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.record_online_payment(text, numeric, text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Public support portal header: organization display name by slug (nothing else).
create or replace function public.public_org_name(p_slug text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select name from public.organizations where slug = p_slug and not is_demo $$;
revoke execute on function public.public_org_name(text) from public;
grant execute on function public.public_org_name(text) to anon, authenticated;

notify pgrst, 'reload schema';
