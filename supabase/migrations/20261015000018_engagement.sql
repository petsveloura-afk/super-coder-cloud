-- ============================================================================
-- SUPER CODER CLOUD — 0018 Engagement: public forms, booking pages +
-- appointments, campaigns (e-mail / WhatsApp / SMS / Telegram). Additive only.
-- Public entry points are SECURITY DEFINER RPCs that validate everything
-- server-side, are rate-limited, and never expose other tenants' data.
-- ============================================================================
create extension if not exists btree_gist with schema extensions;

-- helper: random URL-safe token
create or replace function public.random_token(n int default 24)
returns text
language sql
volatile
set search_path = public, extensions, pg_temp
as $$ select encode(extensions.gen_random_bytes(n), 'hex') $$;

-- ===================================================================== forms
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique default substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12) check (slug ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  status text not null default 'active' check (status in ('active', 'inactive')),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) between 1 and 30),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  submission_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  form_id uuid not null,
  contact_id uuid,
  data jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, form_id) references public.forms (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists form_submissions_form_idx on public.form_submissions (form_id, created_at desc);

-- ================================================ booking & appointments
create table if not exists public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique default substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12) check (slug ~ '^[a-z0-9][a-z0-9-]{2,60}$'),
  description text check (description is null or char_length(description) <= 2000),
  duration_min int not null default 30 check (duration_min between 5 and 480),
  buffer_min int not null default 0 check (buffer_min between 0 and 240),
  location text check (location is null or char_length(location) <= 300),
  host_id uuid not null references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Jerusalem',
  -- {"0":[["09:00","17:00"]], "1":[...], …}  (0 = Sunday)
  availability jsonb not null default '{"0":[["09:00","17:00"]],"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]]}'::jsonb,
  min_notice_hours int not null default 2 check (min_notice_hours between 0 and 720),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 365),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type_id uuid,
  contact_id uuid,
  host_id uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'canceled', 'completed', 'no_show')),
  location text check (location is null or char_length(location) <= 300),
  notes text check (notes is null or char_length(notes) <= 4000),
  public_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (organization_id, type_id) references public.appointment_types (organization_id, id) on delete set null (type_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  -- no double booking for the same host
  constraint appointments_no_overlap exclude using gist (
    host_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'confirmed') and host_id is not null)
);
create index if not exists appointments_org_start_idx on public.appointments (organization_id, starts_at);

-- ================================================================ campaigns
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'telegram')),
  subject text check (subject is null or char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 20000),
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'canceled')),
  scheduled_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  launched_at timestamptz,
  unique (organization_id, id)
);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null,
  contact_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  unsub_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  sent_at timestamptz,
  unique (campaign_id, contact_id),
  foreign key (organization_id, campaign_id) references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);

-- jobs can now belong to a campaign recipient
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('email', 'webhook', 'http', 'whatsapp', 'telegram', 'sms', 'action'));
alter table public.jobs add column if not exists campaign_recipient_id uuid references public.campaign_recipients (id) on delete set null;

-- ===================================================================== RLS
alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.appointment_types enable row level security;
alter table public.appointments enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('forms',             'forms.manage',        'forms.manage',        'forms.manage'),
      ('appointment_types', 'appointments.read',   'appointments.manage', 'appointments.manage'),
      ('appointments',      'appointments.read',   'appointments.manage', 'appointments.manage'),
      ('campaigns',         'campaigns.manage',    'campaigns.manage',    'campaigns.manage')
    ) as v(tbl, r, w, d)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_permission(organization_id, %L))', spec.tbl || '_select', spec.tbl, spec.r);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_permission(organization_id, %L))', spec.tbl || '_insert', spec.tbl, spec.w);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_permission(organization_id, %L)) with check (public.has_permission(organization_id, %L))', spec.tbl || '_update', spec.tbl, spec.w, spec.w);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_permission(organization_id, %L))', spec.tbl || '_delete', spec.tbl, spec.d);
  end loop;
end $$;
create policy form_submissions_select on public.form_submissions for select to authenticated using (public.has_permission(organization_id, 'forms.manage'));
create policy form_submissions_delete on public.form_submissions for delete to authenticated using (public.has_permission(organization_id, 'forms.manage'));
create policy campaign_recipients_select on public.campaign_recipients for select to authenticated using (public.has_permission(organization_id, 'campaigns.manage'));

grant select, insert, update, delete on public.forms, public.appointment_types, public.appointments, public.campaigns to authenticated;
grant select, delete on public.form_submissions to authenticated;
grant select on public.campaign_recipients to authenticated;
revoke insert, update on public.form_submissions from authenticated;
revoke insert, update, delete on public.campaign_recipients from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.forms, public.form_submissions, public.appointment_types, public.appointments, public.campaigns, public.campaign_recipients to service_role;
  end if;
end $$;

-- ===================================================== helper: upsert contact
-- Used by public entry points. Matches by e-mail, then phone; creates otherwise.
create or replace function public.upsert_public_contact(p_org uuid, p_name text, p_email text, p_phone text, p_source text, p_consent boolean, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  ph text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '[\s\-().]', '', 'g'), '');
  nm text := nullif(btrim(coalesce(p_name, '')), '');
  cid uuid;
begin
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em := null; end if;
  if ph is not null and ph !~ '^\+?[0-9]{7,15}$' then ph := null; end if;
  if em is null and ph is null then
    return null;
  end if;
  select id into cid from public.contacts
   where organization_id = p_org and ((em is not null and email = em::citext) or (ph is not null and phone = ph))
   order by (em is not null and email = em::citext) desc, created_at
   limit 1;
  if cid is not null then
    update public.contacts
       set phone = coalesce(phone, ph),
           email = coalesce(email, em::citext),
           marketing_consent = marketing_consent or coalesce(p_consent, false),
           updated_at = now()
     where id = cid;
    return cid;
  end if;
  nm := coalesce(nm, split_part(coalesce(em, ''), '@', 1), ph);
  insert into public.contacts (organization_id, first_name, last_name, email, phone, source, marketing_consent, company_name, utm)
  values (p_org, left(split_part(nm, ' ', 1), 80), left(btrim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), 80), em, ph,
          left(coalesce(p_source, 'form'), 40), coalesce(p_consent, false),
          nullif(left(coalesce(p_extra ->> 'company', ''), 160), ''),
          coalesce(p_extra -> 'utm', '{}'::jsonb))
  returning id into cid;
  return cid;
end;
$$;
revoke execute on function public.upsert_public_contact(uuid, text, text, text, text, boolean, jsonb) from public, anon, authenticated;

create or replace function public.public_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rate_limits as r (bucket, window_start, count)
  values (left(p_bucket, 120), ws, 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning count into c;
  return c <= p_limit;
end;
$$;
revoke execute on function public.public_rate_limit(text, int, int) from public, anon, authenticated;

-- ============================================================ public: forms
create or replace function public.get_public_form(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'name', f.name,
    'fields', f.fields,
    'settings', f.settings - 'notify' - 'tag',
    'org', o.name,
    'locale', o.locale
  )
  from public.forms f join public.organizations o on o.id = f.organization_id
  where f.slug = p_slug and f.status = 'active';
$$;

create or replace function public.submit_form(p_slug text, p_data jsonb, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  f public.forms;
  fld jsonb;
  k text;
  typ text;
  v text;
  clean jsonb := '{}'::jsonb;
  errors jsonb := '{}'::jsonb;
  cid uuid;
  sid uuid;
  consent boolean := false;
  tagname text;
begin
  select * into f from public.forms where slug = p_slug and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 32768 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if not public.public_rate_limit('form:' || f.id || ':' || coalesce(p_meta ->> 'ip_hash', 'anon'), 10, 600) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  for fld in select * from jsonb_array_elements(f.fields) loop
    k := fld ->> 'key';
    typ := coalesce(fld ->> 'type', 'text');
    v := btrim(coalesce(p_data ->> k, ''));
    if typ = 'checkbox' then
      v := case when lower(v) in ('true', 'on', '1', 'yes') then 'true' else '' end;
    end if;
    if v = '' then
      if coalesce((fld ->> 'required')::boolean, false) then errors := errors || jsonb_build_object(k, 'validation.required'); end if;
      continue;
    end if;
    if char_length(v) > (case when typ = 'textarea' then 5000 else 500 end) then
      errors := errors || jsonb_build_object(k, 'validation.tooLong');
    elsif typ = 'email' and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      errors := errors || jsonb_build_object(k, 'validation.email');
    elsif typ = 'phone' and regexp_replace(v, '[\s\-().]', '', 'g') !~ '^\+?[0-9]{7,15}$' then
      errors := errors || jsonb_build_object(k, 'validation.phone');
    elsif typ = 'number' and v !~ '^-?[0-9]+(\.[0-9]+)?$' then
      errors := errors || jsonb_build_object(k, 'validation.number');
    elsif typ = 'date' and v !~ '^\d{4}-\d{2}-\d{2}$' then
      errors := errors || jsonb_build_object(k, 'validation.date');
    elsif typ = 'select' and not (coalesce(fld -> 'options', '[]'::jsonb) ? v) then
      errors := errors || jsonb_build_object(k, 'validation.invalidOption');
    else
      clean := clean || jsonb_build_object(k, v);
    end if;
  end loop;
  if errors <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- map well-known keys onto the contact
  consent := coalesce((clean ->> 'marketing_consent')::boolean, false);
  begin
    cid := public.upsert_public_contact(
      f.organization_id,
      coalesce(clean ->> 'name', btrim(coalesce(clean ->> 'first_name', '') || ' ' || coalesce(clean ->> 'last_name', ''))),
      clean ->> 'email', clean ->> 'phone', 'form', consent,
      jsonb_build_object('company', clean ->> 'company', 'utm', coalesce(p_meta -> 'utm', '{}'::jsonb)));
  exception when others then
    cid := null; -- plan limit: the submission is still stored
  end;

  insert into public.form_submissions (organization_id, form_id, contact_id, data, meta)
  values (f.organization_id, f.id, cid, clean, coalesce(p_meta, '{}'::jsonb) - 'ip_hash')
  returning id into sid;
  update public.forms set submission_count = submission_count + 1 where id = f.id;

  tagname := nullif(left(btrim(coalesce(f.settings ->> 'tag', '')), 40), '');
  if cid is not null and tagname is not null then
    insert into public.tags (organization_id, name) values (f.organization_id, tagname) on conflict (organization_id, name) do nothing;
    insert into public.contact_tags (organization_id, contact_id, tag_id)
    select f.organization_id, cid, t.id from public.tags t where t.organization_id = f.organization_id and t.name = tagname
    on conflict do nothing;
  end if;
  if cid is not null then
    insert into public.notes (organization_id, contact_id, body)
    values (f.organization_id, cid, left('📝 ' || f.name || E'\n' || (select string_agg(key || ': ' || value, E'\n') from jsonb_each_text(clean)), 10000));
  end if;
  if coalesce((f.settings ->> 'notify')::boolean, true) then
    insert into public.notifications (organization_id, user_id, kind, title_key, params)
    select f.organization_id, m.user_id, 'form', 'forms.notification', jsonb_build_object('form', f.name)
      from public.organization_members m
     where m.organization_id = f.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'marketing');
  end if;

  perform public.emit_event(f.organization_id, 'form.submitted', case when cid is null then 'form' else 'contact' end, cid,
    jsonb_build_object('form_id', f.id, 'submission_id', sid, 'contact_id', cid, 'data', clean));

  return jsonb_build_object('ok', true, 'message', f.settings ->> 'success_message', 'redirect', f.settings ->> 'redirect_url');
end;
$$;

-- ========================================================== public: booking
create or replace function public.get_public_booking(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t public.appointment_types;
  o public.organizations;
begin
  select * into t from public.appointment_types where slug = p_slug and status = 'active';
  if not found then
    return null;
  end if;
  select * into o from public.organizations where id = t.organization_id;
  return jsonb_build_object(
    'name', t.name,
    'description', t.description,
    'duration_min', t.duration_min,
    'buffer_min', t.buffer_min,
    'location', t.location,
    'timezone', t.timezone,
    'availability', t.availability,
    'min_notice_hours', t.min_notice_hours,
    'max_days_ahead', t.max_days_ahead,
    'org', o.name,
    'locale', o.locale,
    'host', (select coalesce(p.full_name, '') from public.profiles p where p.id = t.host_id),
    -- busy intervals only (no names / details)
    'busy', coalesce((
      select jsonb_agg(jsonb_build_array(a.starts_at, a.ends_at) order by a.starts_at)
        from public.appointments a
       where a.host_id = t.host_id and a.status in ('scheduled', 'confirmed')
         and a.ends_at > now() and a.starts_at < now() + make_interval(days => t.max_days_ahead + 1)
    ), '[]'::jsonb)
  );
end;
$$;

-- Is [p_start, p_start+duration) inside the type's weekly availability (in its timezone)?
create or replace function public.slot_is_available(p_type public.appointment_types, p_start timestamptz)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  local_start timestamp := p_start at time zone p_type.timezone;
  local_end timestamp := (p_start + make_interval(mins => p_type.duration_min)) at time zone p_type.timezone;
  dow text := extract(dow from local_start)::int::text;
  win jsonb;
begin
  if local_start::date <> local_end::date and local_end::time <> '00:00' then
    return false;
  end if;
  for win in select * from jsonb_array_elements(coalesce(p_type.availability -> dow, '[]'::jsonb)) loop
    if local_start::time >= (win ->> 0)::time and (case when local_end::time = '00:00' then '24:00'::time else local_end::time end) <= (win ->> 1)::time then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.book_appointment(p_slug text, p_start timestamptz, p_name text, p_email text, p_phone text, p_notes text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  t public.appointment_types;
  cid uuid;
  aid uuid;
  tok text;
  st timestamptz := date_trunc('minute', p_start);
  en timestamptz;
begin
  select * into t from public.appointment_types where slug = p_slug and status = 'active';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.public_rate_limit('book:' || t.id || ':' || coalesce(p_meta ->> 'ip_hash', 'anon'), 5, 600) then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if btrim(coalesce(p_name, '')) = '' or (coalesce(btrim(p_email), '') = '' and coalesce(btrim(p_phone), '') = '') then
    return jsonb_build_object('ok', false, 'error', 'booking.detailsRequired');
  end if;
  en := st + make_interval(mins => t.duration_min);
  if st < now() + make_interval(hours => t.min_notice_hours) or st > now() + make_interval(days => t.max_days_ahead) then
    return jsonb_build_object('ok', false, 'error', 'booking.outOfRange');
  end if;
  if not public.slot_is_available(t, st) then
    return jsonb_build_object('ok', false, 'error', 'booking.notAvailable');
  end if;
  -- serialize bookings per host; buffer applies on both sides
  perform pg_advisory_xact_lock(hashtext('host:' || t.host_id::text));
  if exists (
    select 1 from public.appointments a
     where a.host_id = t.host_id and a.status in ('scheduled', 'confirmed')
       and tstzrange(a.starts_at - make_interval(mins => t.buffer_min), a.ends_at + make_interval(mins => t.buffer_min), '[)') && tstzrange(st, en, '[)')
  ) then
    return jsonb_build_object('ok', false, 'error', 'booking.taken');
  end if;

  begin
    cid := public.upsert_public_contact(t.organization_id, p_name, p_email, p_phone, 'website', false, '{}'::jsonb);
  exception when others then
    cid := null;
  end;
  insert into public.appointments (organization_id, type_id, contact_id, host_id, title, starts_at, ends_at, location, notes)
  values (t.organization_id, t.id, cid, t.host_id, left(t.name || ' — ' || btrim(p_name), 200), st, en, t.location, nullif(left(btrim(coalesce(p_notes, '')), 4000), ''))
  returning id, public_token into aid, tok;

  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  values (t.organization_id, t.host_id, 'appointment', 'appointments.notification',
          jsonb_build_object('name', left(btrim(p_name), 80), 'type', t.name), null);
  perform public.emit_event(t.organization_id, 'appointment.booked', case when cid is null then 'appointment' else 'contact' end, cid,
    jsonb_build_object('appointment_id', aid, 'type_id', t.id, 'contact_id', cid, 'starts_at', st));
  return jsonb_build_object('ok', true, 'appointment_id', aid, 'token', tok, 'starts_at', st, 'ends_at', en);
end;
$$;

create or replace function public.cancel_public_appointment(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.appointments;
begin
  update public.appointments set status = 'canceled'
   where public_token = p_token and status in ('scheduled', 'confirmed') and starts_at > now()
  returning * into a;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  if a.host_id is not null then
    insert into public.notifications (organization_id, user_id, kind, title_key, params)
    values (a.organization_id, a.host_id, 'appointment', 'appointments.canceledNotification', jsonb_build_object('title', a.title));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ================================================================ campaigns
create or replace function public.campaign_audience(p_org uuid, p_channel text, p_audience jsonb)
returns table (contact_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
    from public.contacts c
   where c.organization_id = p_org
     and c.marketing_consent                                   -- campaigns only reach opted-in contacts
     and case p_channel
           when 'email' then c.email is not null
           when 'telegram' then c.custom_fields ? 'telegram_id'
           else c.phone is not null
         end
     and (coalesce(p_audience ->> 'status', '') = '' or c.status::text = p_audience ->> 'status')
     and (coalesce(p_audience ->> 'source', '') = '' or c.source = p_audience ->> 'source')
     and (coalesce(jsonb_array_length(p_audience -> 'tags'), 0) = 0 or exists (
           select 1 from public.contact_tags ct join public.tags t on t.id = ct.tag_id
            where ct.contact_id = c.id and t.name in (select jsonb_array_elements_text(p_audience -> 'tags'))))
$$;

create or replace function public.preview_campaign_audience(p_org uuid, p_channel text, p_audience jsonb)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission(p_org, 'campaigns.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select count(*) from public.campaign_audience(p_org, p_channel, p_audience));
end;
$$;

create or replace function public.launch_campaign(p_org uuid, p_campaign uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.campaigns;
  n int;
begin
  if not public.has_permission(p_org, 'campaigns.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into c from public.campaigns where id = p_campaign and organization_id = p_org for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'scheduled') then
    raise exception 'campaign_already_launched' using errcode = '22023';
  end if;
  if (select is_demo from public.organizations where id = p_org) then
    raise exception 'demo_mode' using errcode = '42501';
  end if;

  insert into public.campaign_recipients (organization_id, campaign_id, contact_id)
  select p_org, c.id, a.contact_id from public.campaign_audience(p_org, c.channel, c.audience) a
  on conflict do nothing;
  get diagnostics n = row_count;

  insert into public.jobs (organization_id, kind, payload, run_after, campaign_recipient_id, max_attempts)
  select p_org, c.channel, jsonb_build_object('campaign_id', c.id, 'recipient_id', r.id, 'contact_id', r.contact_id), greatest(now(), coalesce(c.scheduled_at, now())), r.id, 4
    from public.campaign_recipients r where r.campaign_id = c.id and r.status = 'queued';

  update public.campaigns
     set status = case when c.scheduled_at is not null and c.scheduled_at > now() then 'scheduled' else 'sending' end,
         launched_at = now(),
         stats = jsonb_build_object('recipients', n, 'sent', 0, 'failed', 0)
   where id = c.id;
  return jsonb_build_object('recipients', n);
end;
$$;

-- Called by the dispatcher (service role) after each campaign message.
create or replace function public.campaign_recipient_result(p_recipient uuid, p_ok boolean, p_error text, p_final boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.campaign_recipients;
  pending int;
begin
  if not p_ok and not p_final then
    return; -- will be retried
  end if;
  update public.campaign_recipients
     set status = case when p_ok then 'sent' else 'failed' end, error = case when p_ok then null else left(p_error, 300) end, sent_at = now()
   where id = p_recipient and status = 'queued'
  returning * into r;
  if not found then
    return;
  end if;
  update public.campaigns c
     set stats = c.stats
       || jsonb_build_object('sent', (select count(*) from public.campaign_recipients x where x.campaign_id = r.campaign_id and x.status = 'sent'))
       || jsonb_build_object('failed', (select count(*) from public.campaign_recipients x where x.campaign_id = r.campaign_id and x.status = 'failed'))
   where c.id = r.campaign_id;
  select count(*) into pending from public.campaign_recipients where campaign_id = r.campaign_id and status = 'queued';
  if pending = 0 then
    update public.campaigns set status = 'sent' where id = r.campaign_id and status in ('sending', 'scheduled');
  end if;
end;
$$;

-- Content for one campaign message (service role): rendered with the recipient's data.
create or replace function public.campaign_message(p_recipient uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.campaign_recipients;
  c public.campaigns;
  ctx jsonb;
begin
  select * into r from public.campaign_recipients where id = p_recipient;
  if not found then return null; end if;
  select * into c from public.campaigns where id = r.campaign_id;
  if c.status = 'canceled' then return jsonb_build_object('canceled', true); end if;
  select jsonb_build_object('contact', to_jsonb(ct) - 'search', 'org', jsonb_build_object('name', o.name))
    into ctx from public.contacts ct join public.organizations o on o.id = ct.organization_id where ct.id = r.contact_id;
  if ctx is null or not coalesce((ctx #>> '{contact,marketing_consent}')::boolean, false) then
    return jsonb_build_object('skip', true);
  end if;
  return jsonb_build_object(
    'channel', c.channel,
    'to', case c.channel when 'email' then ctx #>> '{contact,email}' else null end,
    'subject', public.render_template(coalesce(c.subject, ''), ctx),
    'body', public.render_template(c.body, ctx),
    'contact_id', r.contact_id,
    'unsub_token', r.unsub_token,
    'locale', (select locale from public.organizations where id = c.organization_id)
  );
end;
$$;

create or replace function public.unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.campaign_recipients;
begin
  select * into r from public.campaign_recipients where unsub_token = p_token;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  update public.contacts set marketing_consent = false, updated_at = now() where id = r.contact_id;
  insert into public.activities (organization_id, contact_id, type, payload)
  values (r.organization_id, r.contact_id, 'contact.unsubscribed', jsonb_build_object('campaign_id', r.campaign_id));
  return jsonb_build_object('ok', true, 'org', (select name from public.organizations where id = r.organization_id));
end;
$$;

-- ================================================================== grants
do $$
declare
  f text;
begin
  -- public (anon) entry points
  foreach f in array array[
    'public.get_public_form(text)',
    'public.submit_form(text, jsonb, jsonb)',
    'public.get_public_booking(text)',
    'public.book_appointment(text, timestamptz, text, text, text, text, jsonb)',
    'public.cancel_public_appointment(text)',
    'public.unsubscribe(text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  -- members
  foreach f in array array['public.preview_campaign_audience(uuid, text, jsonb)', 'public.launch_campaign(uuid, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- service role only
  foreach f in array array[
    'public.campaign_recipient_result(uuid, boolean, text, boolean)',
    'public.campaign_message(uuid)',
    'public.campaign_audience(uuid, text, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
