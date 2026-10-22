-- =============================================================================
-- Wave 17 — marketing & websites (additive only).
--
--  * automations: new triggers site.behavior (visits / time on a page of the business's
--    site), quote.viewed, contract.signed, lead.hot, customer.opted_out
--  * site_events / site_visitors   privacy-friendly tracking on published sites
--    (random visitor id, no IP stored); a visitor becomes a contact on form submit
--  * A/B tests on sites: variant B of the hero (title / text / button), even split per
--    visitor, views + conversions per variant, the winner applied automatically
--  * campaigns: smarter audience (score, sentiment, activity, purchases, stage) — and
--    opted-out customers are never included; WhatsApp approved templates
--  * forms: steps + conditional fields (show a field only when another answer matches)
--  * appointment reminders 24h / 1h before (with confirm / cancel)
--  * conversion APIs (Meta CAPI, GA4 Measurement Protocol, TikTok Events) — job "conversion"
--  * web push subscriptions (browser / installed app notifications)
-- =============================================================================

update public.plans set features = array_append(features, 'ab_testing')
 where key in ('pro', 'business', 'enterprise') and not ('ab_testing' = any (features));
update public.plans set features = array_append(features, 'conversion_api')
 where key in ('pro', 'business', 'enterprise') and not ('conversion_api' = any (features));

-- ------------------------------------------------------------- automations ----
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.automations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%trigger_type%'
  loop
    execute format('alter table public.automations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.automations add constraint automations_trigger_type_check check (trigger_type in (
  'contact.created', 'contact.status_changed', 'contact.tagged',
  'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'task.completed', 'webhook.inbound',
  'form.submitted', 'message.received', 'appointment.booked', 'ticket.created', 'invoice.paid',
  'site.behavior', 'quote.viewed', 'contract.signed', 'lead.hot', 'customer.opted_out'));

-- run_automations (from wave 9) + targeted site.behavior events
create or replace function public.run_automations(p_event public.events)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.automations;
  ctx jsonb;
  cond jsonb;
  act jsonb;
  step jsonb;
  steps jsonb;
  failed int;
  passed boolean;
  ran int := 0;
begin
  for a in
    select * from public.automations
     where organization_id = p_event.organization_id and enabled and trigger_type = p_event.type
     order by created_at
  loop
    if a.trigger_type = 'webhook.inbound' and p_event.payload ->> 'automation_id' is distinct from a.id::text then
      continue;
    end if;
    -- wave 17: behavior events are evaluated per automation (its own thresholds) and
    -- carry the automation's id; trigger_config holds thresholds, not payload filters
    if a.trigger_type = 'site.behavior' then
      if p_event.payload ->> 'automation_id' is distinct from a.id::text then
        continue;
      end if;
    elsif exists (
      select 1 from jsonb_each_text(a.trigger_config) kv
       where kv.value <> '' and coalesce(p_event.payload ->> kv.key, '') <> kv.value
    ) then
      continue;
    end if;
    if ctx is null then
      ctx := public.automation_context(p_event);
    end if;

    passed := true;
    for cond in select * from jsonb_array_elements(a.conditions) loop
      if not public.eval_condition(ctx, cond) then
        passed := false;
        exit;
      end if;
    end loop;
    if not passed then
      insert into public.automation_runs (organization_id, automation_id, event_id, status, steps)
      values (a.organization_id, a.id, p_event.id, 'skipped', '[]'::jsonb)
      on conflict do nothing;
      continue;
    end if;

    steps := '[]'::jsonb;
    failed := 0;
    for act in select * from jsonb_array_elements(a.actions) loop
      begin
        step := public.execute_automation_action(a.organization_id, a.id, p_event.id, act, ctx);
      exception when others then
        failed := failed + 1;
        step := jsonb_build_object('type', act ->> 'type', 'status', 'error', 'detail', left(sqlerrm, 300));
      end;
      steps := steps || jsonb_build_array(step);
    end loop;

    insert into public.automation_runs (organization_id, automation_id, event_id, status, steps, error)
    values (a.organization_id, a.id, p_event.id,
            case when failed = 0 then 'success' when failed = jsonb_array_length(a.actions) then 'failed' else 'partial' end,
            steps,
            case when failed > 0 then (select string_agg(s ->> 'detail', '; ') from jsonb_array_elements(steps) s where s ->> 'status' = 'error') end)
    on conflict do nothing;
    update public.automations set run_count = run_count + 1, last_run_at = now() where id = a.id;
    ran := ran + 1;
  end loop;
  return ran;
end;
$$;


-- events for the new triggers (from existing wave-15 / guard activity)
create or replace function public.activities_emit_wave17()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type = 'document.viewed' and (new.payload ->> 'kind') = 'quote' then
    perform public.emit_event(new.organization_id, 'quote.viewed', 'contact', new.contact_id, new.payload || jsonb_build_object('contact_id', new.contact_id));
  elsif new.type = 'quote.signed' then
    perform public.emit_event(new.organization_id, 'contract.signed', 'contact', new.contact_id, new.payload || jsonb_build_object('contact_id', new.contact_id));
  elsif new.type = 'contact.opted_out' then
    perform public.emit_event(new.organization_id, 'customer.opted_out', 'contact', new.contact_id, new.payload || jsonb_build_object('contact_id', new.contact_id));
  end if;
  return null;
end;
$$;
drop trigger if exists activities_emit_wave17 on public.activities;
create trigger activities_emit_wave17 after insert on public.activities
  for each row when (new.contact_id is not null and new.type in ('document.viewed', 'quote.signed', 'contact.opted_out'))
  execute function public.activities_emit_wave17();

create or replace function public.conversations_emit_hot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.lead_score = 'hot' and old.lead_score is distinct from 'hot' and new.contact_id is not null then
    perform public.emit_event(new.organization_id, 'lead.hot', 'contact', new.contact_id,
      jsonb_build_object('contact_id', new.contact_id, 'conversation_id', new.id, 'channel', new.channel));
  end if;
  return null;
end;
$$;
drop trigger if exists conversations_emit_hot on public.conversations;
create trigger conversations_emit_hot after update of lead_score on public.conversations
  for each row execute function public.conversations_emit_hot();

-- ------------------------------------------------------------ site tracking ----
create table if not exists public.site_visitors (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  contact_id uuid,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (organization_id, visitor_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  visitor_id text not null,
  path text not null default '/' check (char_length(path) <= 300),
  event text not null check (event in ('view', 'time', 'click', 'convert')),
  seconds int not null default 0 check (seconds between 0 and 86400),
  variant text check (variant is null or variant in ('a', 'b')),
  created_at timestamptz not null default now()
);
create index if not exists site_events_visitor on public.site_events (organization_id, visitor_id, created_at desc);
create index if not exists site_events_site on public.site_events (site_id, created_at desc);
alter table public.site_visitors enable row level security;
alter table public.site_events enable row level security;
drop policy if exists site_events_read on public.site_events;
create policy site_events_read on public.site_events for select to authenticated using (public.has_permission(organization_id, 'websites.manage'));
drop policy if exists site_visitors_read on public.site_visitors;
create policy site_visitors_read on public.site_visitors for select to authenticated using (public.has_permission(organization_id, 'websites.manage'));
revoke insert, update, delete on public.site_events, public.site_visitors from anon, authenticated;
grant select on public.site_events, public.site_visitors to authenticated;

-- public: one tracking event from a published site; evaluates "site.behavior" automations
create or replace function public.track_site_event(p_slug text, p_visitor text, p_path text, p_event text, p_seconds int default 0, p_variant text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.sites;
  v public.site_visitors;
  a record;
  views int;
  secs int;
  path text := left(coalesce(nullif(btrim(p_path), ''), '/'), 300);
begin
  if p_visitor !~ '^[A-Za-z0-9_-]{8,64}$' or p_event not in ('view', 'time', 'click', 'convert') then
    return jsonb_build_object('ok', false);
  end if;
  select * into s from public.sites where slug = p_slug and status = 'published';
  if not found then return jsonb_build_object('ok', false); end if;
  if not public.public_rate_limit('track:' || s.id || ':' || p_visitor, 120, 3600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.site_visitors as x (organization_id, visitor_id) values (s.organization_id, p_visitor)
  on conflict (organization_id, visitor_id) do update set last_seen = now()
  returning * into v;
  insert into public.site_events (organization_id, site_id, visitor_id, path, event, seconds, variant)
  values (s.organization_id, s.id, p_visitor, path, p_event, greatest(0, least(coalesce(p_seconds, 0), 86400)), case when p_variant in ('a', 'b') then p_variant end);

  -- behavior rules only for known visitors (they left their details on a form / chat)
  if v.contact_id is not null and p_event in ('view', 'time') then
    for a in
      select id, trigger_config from public.automations
       where organization_id = s.organization_id and enabled and trigger_type = 'site.behavior'
    loop
      if coalesce(a.trigger_config ->> 'path_contains', '') <> '' and position(lower(a.trigger_config ->> 'path_contains') in lower(path)) = 0 then
        continue;
      end if;
      select count(*) filter (where e.event = 'view'), coalesce(sum(e.seconds) filter (where e.event = 'time'), 0)
        into views, secs
        from public.site_events e
       where e.organization_id = s.organization_id and e.visitor_id = p_visitor and e.created_at > now() - interval '30 days'
         and (coalesce(a.trigger_config ->> 'path_contains', '') = '' or position(lower(a.trigger_config ->> 'path_contains') in lower(e.path)) > 0);
      if views >= greatest(1, coalesce((a.trigger_config ->> 'min_visits')::int, 1))
         and secs >= greatest(0, coalesce((a.trigger_config ->> 'min_seconds')::int, 0))
         and public.public_rate_limit('sitebeh:' || a.id || ':' || p_visitor, 1, 86400) then
        perform public.emit_event(s.organization_id, 'site.behavior', 'contact', v.contact_id,
          jsonb_build_object('contact_id', v.contact_id, 'automation_id', a.id, 'path', path, 'visits', views, 'seconds', secs, 'site', s.slug));
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.track_site_event(text, text, text, text, int, text) from public;
grant execute on function public.track_site_event(text, text, text, text, int, text) to anon, authenticated, service_role;

-- a visitor who submitted a form / chat is linked to the contact (server, after the submit)
create or replace function public.link_site_visitor(p_org uuid, p_visitor text, p_contact uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.site_visitors (organization_id, visitor_id, contact_id) values (p_org, p_visitor, p_contact)
  on conflict (organization_id, visitor_id) do update set contact_id = excluded.contact_id, last_seen = now();
$$;
revoke all on function public.link_site_visitor(uuid, text, uuid) from public, anon, authenticated;

-- retention: behavior events are kept 180 days (batches, run by the growth cron)
create or replace function public.purge_site_events(p_days int default 180, p_limit int default 20000)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  delete from public.site_events where id in (
    select id from public.site_events where created_at < now() - make_interval(days => greatest(30, p_days)) order by id limit greatest(1, least(p_limit, 100000)));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.purge_site_events(int, int) from public, anon, authenticated;

-- ------------------------------------------------------------------- A/B ----
alter table public.sites add column if not exists ab jsonb;
do $$ begin
  alter table public.sites add constraint sites_ab_object check (ab is null or (jsonb_typeof(ab) = 'object' and pg_column_size(ab) < 20000));
exception when duplicate_object then null; end $$;

create or replace function public.site_ab_stats(p_site uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'a_views', count(distinct visitor_id) filter (where variant = 'a' and event = 'view'),
    'b_views', count(distinct visitor_id) filter (where variant = 'b' and event = 'view'),
    'a_conv', count(distinct visitor_id) filter (where variant = 'a' and event = 'convert'),
    'b_conv', count(distinct visitor_id) filter (where variant = 'b' and event = 'convert'))
  from public.site_events
  where site_id = p_site
    and created_at >= coalesce((select (ab ->> 'started_at')::timestamptz from public.sites where id = p_site), now() - interval '90 days');
$$;
revoke all on function public.site_ab_stats(uuid) from public, anon;
grant execute on function public.site_ab_stats(uuid) to authenticated, service_role;

-- the public page needs the variant B content
create or replace function public.get_public_site_ab(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when ab is not null and coalesce((ab ->> 'active')::boolean, false) then ab - 'stats' end
    from public.sites where slug = p_slug and status = 'published';
$$;
revoke all on function public.get_public_site_ab(text) from public;
grant execute on function public.get_public_site_ab(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------- campaigns ----
alter table public.campaigns add column if not exists wa_template jsonb;
do $$ begin
  alter table public.campaigns add constraint campaigns_wa_template_object check (wa_template is null or (jsonb_typeof(wa_template) = 'object' and pg_column_size(wa_template) < 4000));
exception when duplicate_object then null; end $$;

-- audience: the original filters + smart ones; opted-out customers never included
create or replace function public.campaign_audience(p_org uuid, p_channel text, p_audience jsonb)
returns table (contact_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
    from public.contacts c
    left join public.contact_insights ci on ci.contact_id = c.id
   where c.organization_id = p_org
     and c.marketing_consent                                   -- campaigns only reach opted-in contacts
     and c.opted_out_at is null                                -- conversation guard: STOP / הסר
     and not exists (select 1 from public.conversations cv where cv.contact_id = c.id and cv.opt_out)
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
     -- wave 17: smart audience
     and (p_audience ->> 'min_score' is null or coalesce(ci.lead_score, 0) >= (p_audience ->> 'min_score')::int)
     and (p_audience ->> 'max_score' is null or coalesce(ci.lead_score, 0) <= (p_audience ->> 'max_score')::int)
     and (coalesce(p_audience ->> 'sentiment', '') = '' or ci.sentiment = p_audience ->> 'sentiment')
     and (coalesce(p_audience ->> 'stage', '') = '' or ci.stage = p_audience ->> 'stage')
     and (p_audience ->> 'active_days' is null or ci.last_inbound_at > now() - make_interval(days => (p_audience ->> 'active_days')::int))
     and (p_audience ->> 'inactive_days' is null or ci.last_inbound_at is null or ci.last_inbound_at < now() - make_interval(days => (p_audience ->> 'inactive_days')::int))
     and (p_audience ->> 'purchases_min' is null or coalesce((select sum(p.amount) from public.payments p join public.documents d on d.id = p.document_id
                                                              where d.contact_id = c.id), 0) >= (p_audience ->> 'purchases_min')::numeric)
$$;


-- campaign_message (wave 5) + the WhatsApp approved template with rendered variables
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
  tpl jsonb;
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
  -- wave 17: opted out (STOP / הסר) on any channel → never part of a campaign
  if (ctx #>> '{contact,opted_out_at}') is not null then
    return jsonb_build_object('skip', true);
  end if;
  if c.channel = 'whatsapp' and c.wa_template is not null and coalesce(c.wa_template ->> 'name', '') <> '' then
    tpl := jsonb_build_object(
      'name', c.wa_template ->> 'name',
      'language', coalesce(nullif(c.wa_template ->> 'language', ''), 'he'),
      'params', coalesce((select jsonb_agg(public.render_template(x, ctx) order by n)
                            from jsonb_array_elements_text(coalesce(c.wa_template -> 'params', '[]'::jsonb)) with ordinality as e(x, n)), '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'channel', c.channel,
    'to', case c.channel when 'email' then ctx #>> '{contact,email}' else null end,
    'subject', public.render_template(coalesce(c.subject, ''), ctx),
    'body', public.render_template(c.body, ctx),
    'contact_id', r.contact_id,
    'unsub_token', r.unsub_token,
    'locale', (select locale from public.organizations where id = c.organization_id),
    'wa_template', tpl
  );
end;
$$;

-- ------------------------------------------------------------------ forms ----
create or replace function public.form_field_visible(p_field jsonb, p_data jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_field -> 'show_if') <> 'object' or coalesce(p_field #>> '{show_if,field}', '') = '' then true
    when p_field #>> '{show_if,op}' = 'not_empty' then btrim(coalesce(p_data ->> (p_field #>> '{show_if,field}'), '')) <> ''
    when p_field #>> '{show_if,op}' = 'neq' then lower(btrim(coalesce(p_data ->> (p_field #>> '{show_if,field}'), ''))) <> lower(btrim(coalesce(p_field #>> '{show_if,value}', '')))
    else lower(btrim(coalesce(p_data ->> (p_field #>> '{show_if,field}'), ''))) = lower(btrim(coalesce(p_field #>> '{show_if,value}', '')))
  end;
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
    -- wave 17: conditional fields — a field hidden by its condition is neither required nor stored
    if not public.form_field_visible(fld, p_data) then
      continue;
    end if;
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
  values (f.organization_id, f.id, cid, clean, coalesce(p_meta, '{}'::jsonb) - 'ip_hash' - 'visitor')
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

  -- wave 17: the website visitor who filled the form is now a known contact (behavior triggers)
  if cid is not null and coalesce(p_meta ->> 'visitor', '') ~ '^[A-Za-z0-9_-]{8,64}$' then
    perform public.link_site_visitor(f.organization_id, p_meta ->> 'visitor', cid);
  end if;
  return jsonb_build_object('ok', true, 'message', f.settings ->> 'success_message', 'redirect', f.settings ->> 'redirect_url');
end;
$$;

-- ------------------------------------------------------ appointment reminders ----
alter table public.appointments add column if not exists reminded_24_at timestamptz;
alter table public.appointments add column if not exists reminded_1_at timestamptz;

create or replace function public.claim_appointment_reminders(p_limit int default 50)
returns table (appointment_id uuid, organization_id uuid, contact_id uuid, title text, starts_at timestamptz, location text, window_kind text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id, case when a.starts_at <= now() + interval '75 minutes' then '1h' else '24h' end as w
      from public.appointments a
     where a.status in ('scheduled', 'confirmed') and a.contact_id is not null and a.starts_at > now()
       and ((a.starts_at <= now() + interval '25 hours' and a.starts_at > now() + interval '3 hours' and a.reminded_24_at is null)
         or (a.starts_at <= now() + interval '75 minutes' and a.reminded_1_at is null))
       and a.created_at < now() - interval '10 minutes'
     order by a.starts_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  ), upd as (
    update public.appointments a
       set reminded_24_at = case when due.w = '24h' then now() else a.reminded_24_at end,
           reminded_1_at = case when due.w = '1h' then now() else a.reminded_1_at end
      from due where a.id = due.id
    returning a.id, a.organization_id, a.contact_id, a.title, a.starts_at, a.location, due.w
  )
  select * from upd;
end;
$$;
revoke all on function public.claim_appointment_reminders(int) from public, anon, authenticated;

-- ------------------------------------------------------------ conversions ----
-- business events → the ad platforms the business connected (job "conversion")
create or replace function public.queue_conversion(p_org uuid, p_event text, p_contact uuid, p_value numeric, p_currency text, p_ref text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.integrations i where i.organization_id = p_org and i.provider in ('meta_capi', 'ga4', 'tiktok') and i.status = 'active') then
    return;
  end if;
  if not public.has_feature(p_org, 'conversion_api') then return; end if;
  insert into public.jobs (organization_id, kind, payload)
  values (p_org, 'conversion', jsonb_build_object('event', p_event, 'contact_id', p_contact, 'value', p_value, 'currency', p_currency, 'ref', p_ref, 'at', now()));
end;
$$;
revoke all on function public.queue_conversion(uuid, text, uuid, numeric, text, text) from public, anon, authenticated;

create or replace function public.conversions_from_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  if new.type = 'contact.created' then
    perform public.queue_conversion(new.organization_id, 'Lead', new.entity_id, null, null, 'contact:' || new.entity_id);
  elsif new.type = 'appointment.booked' then
    perform public.queue_conversion(new.organization_id, 'Schedule', (new.payload ->> 'contact_id')::uuid, null, null, 'appt:' || coalesce(new.payload ->> 'appointment_id', new.id::text));
  elsif new.type = 'invoice.paid' then
    select * into d from public.documents where id = coalesce((new.payload ->> 'document_id')::uuid, new.entity_id);
    if found then
      perform public.queue_conversion(new.organization_id, 'Purchase', d.contact_id, d.total, d.currency, 'doc:' || d.id);
    end if;
  end if;
  return null;
exception when others then
  return null; -- never break the business action
end;
$$;
drop trigger if exists events_conversions on public.events;
create trigger events_conversions after insert on public.events
  for each row when (new.type in ('contact.created', 'appointment.booked', 'invoice.paid'))
  execute function public.conversions_from_events();

-- ------------------------------------------------------------------ push ----
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- every in-app notification → a push job for that member's devices
create or replace function public.notifications_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    insert into public.jobs (organization_id, kind, payload, max_attempts)
    values (new.organization_id, 'push', jsonb_build_object('notification_id', new.id), 3);
  end if;
  return null;
end;
$$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.notifications_push();

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.site_events, public.site_visitors, public.push_subscriptions to service_role';
    execute 'grant execute on function public.link_site_visitor(uuid, text, uuid), public.claim_appointment_reminders(int), public.queue_conversion(uuid, text, uuid, numeric, text, text), public.purge_site_events(int, int) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
