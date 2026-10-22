-- =============================================================================
-- Wave 15 — CRM & sales intelligence (additive only).
--
--  * contact_identities      every way a customer reaches the business (phone,
--                            e-mail, Telegram, website chat…) → one contact.
--                            Channel-created duplicates are merged automatically.
--  * merge_contacts_v2       merge that also moves conversations, appointments,
--                            documents, tickets, form submissions and campaigns.
--  * contact_timeline        one timeline across every channel and module.
--  * contact_insights        lead score (0-100) with a breakdown, sentiment,
--                            buying stage and the AI's next best action.
--  * pipeline_stages.auto_on deals move forward by themselves on business events
--                            (quote sent / viewed / accepted / signed, deposit,
--                            invoice paid, meeting booked, AI hot lead).
--  * documents               contract terms + drawn signature with a tamper hash,
--                            view tracking; quick payment links; PayPal into the
--                            business's own account; invoicing (Morning / iCount).
--  * tasks.remind_at         reminders to the assignee (Telegram / WhatsApp / SMS /
--                            e-mail) with "done" / "snooze" actions.
--  * lead routing            round robin / least loaded between available members.
-- =============================================================================

-- ------------------------------------------------------------ plan features ----
update public.plans set features = array_append(features, 'contracts')
 where key in ('pro', 'business', 'enterprise') and not ('contracts' = any (features));
update public.plans set features = array_append(features, 'lead_routing')
 where key in ('pro', 'business', 'enterprise') and not ('lead_routing' = any (features));
update public.plans set features = array_append(features, 'invoicing_sync')
 where key in ('pro', 'business', 'enterprise') and not ('invoicing_sync' = any (features));
update public.plans set features = array_append(features, 'ai_insights')
 where key in ('pro', 'business', 'enterprise') and not ('ai_insights' = any (features));

-- -------------------------------------------------------------- jobs kinds ----
-- new side effects run by the dispatcher (superset of the previous list)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_kind_check check (kind in (
  'email', 'webhook', 'http', 'whatsapp', 'telegram', 'sms', 'action',
  'invoice', 'conversion', 'push', 'calendar', 'reminder', 'call'));

-- ------------------------------------------------------- AI usage features ----
-- metered AI features added in waves 15-18 (superset of the previous list)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.ai_usage'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%feature%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in (
  'contact_summary', 'followup_draft', 'agent_chat', 'site_builder', 'image_gen', 'autopilot',
  'insights', 'copilot', 'segment', 'site_copy', 'vision', 'transcribe', 'voice', 'kb', 'forecast', 'ab_variant'));

-- ---------------------------------------------------------- phone helper ----
-- E.164 with a default Israeli prefix (05X… → +9725X…), same rule as toE164() in the app
create or replace function public.norm_phone(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when x is null or x = '' then null
    when x ~ '^\+[0-9]{7,15}$' then x
    when x ~ '^00[0-9]{7,15}$' then '+' || substr(x, 3)
    when x ~ '^0[0-9]{6,14}$' then '+972' || substr(x, 2)
    when x ~ '^[0-9]{7,15}$' then '+' || x
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as x) s;
$$;

-- ===================================================== contact identities ====
create table if not exists public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  kind text not null check (kind in ('phone', 'email', 'telegram', 'web', 'other')),
  value text not null check (char_length(value) between 1 and 200),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now(),
  unique (organization_id, kind, value),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index if not exists contact_identities_contact on public.contact_identities (contact_id);
alter table public.contact_identities enable row level security;
drop policy if exists contact_identities_read on public.contact_identities;
create policy contact_identities_read on public.contact_identities for select to authenticated
  using (public.has_permission(organization_id, 'contacts.read'));
revoke insert, update, delete on public.contact_identities from anon, authenticated;
grant select on public.contact_identities to authenticated;

-- identity of a conversation's external id
create or replace function public.channel_identity(p_channel text, p_external text)
returns table (kind text, value text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select * from (
    select case
             when p_channel in ('whatsapp', 'whatsapp_qr', 'sms') then 'phone'
             when p_channel = 'email' then 'email'
             when p_channel in ('telegram', 'telegram_user') then 'telegram'
             when p_channel = 'web' then 'web'
             else 'other' end,
           case
             when p_channel in ('whatsapp', 'whatsapp_qr', 'sms') then public.norm_phone(p_external)
             when p_channel = 'email' then lower(btrim(p_external))
             when p_channel in ('telegram', 'telegram_user') then regexp_replace(p_external, '^biz:', '')
             else left(p_external, 200) end
  ) s(kind, value) where value is not null and value <> '';
$$;

create or replace function public.contacts_identity_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.phone is not null and public.norm_phone(new.phone) is not null then
    insert into public.contact_identities (organization_id, contact_id, kind, value, source)
    values (new.organization_id, new.id, 'phone', public.norm_phone(new.phone), 'contact')
    on conflict (organization_id, kind, value) do nothing;
  end if;
  if new.email is not null then
    insert into public.contact_identities (organization_id, contact_id, kind, value, source)
    values (new.organization_id, new.id, 'email', lower(new.email::text), 'contact')
    on conflict (organization_id, kind, value) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists contacts_identity_sync on public.contacts;
create trigger contacts_identity_sync after insert or update of phone, email on public.contacts
  for each row execute function public.contacts_identity_sync();

create or replace function public.conversations_identity_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.contact_id is not null then
    insert into public.contact_identities (organization_id, contact_id, kind, value, source)
    select new.organization_id, new.contact_id, i.kind, i.value, new.channel
      from public.channel_identity(new.channel, new.external_id) i
    on conflict (organization_id, kind, value) do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists conversations_identity_sync on public.conversations;
create trigger conversations_identity_sync after insert or update of contact_id on public.conversations
  for each row execute function public.conversations_identity_sync();

-- backfill existing data
insert into public.contact_identities (organization_id, contact_id, kind, value, source)
select organization_id, id, 'phone', public.norm_phone(phone), 'contact' from public.contacts
 where phone is not null and public.norm_phone(phone) is not null
on conflict (organization_id, kind, value) do nothing;
insert into public.contact_identities (organization_id, contact_id, kind, value, source)
select organization_id, id, 'email', lower(email::text), 'contact' from public.contacts where email is not null
on conflict (organization_id, kind, value) do nothing;
insert into public.contact_identities (organization_id, contact_id, kind, value, source)
select c.organization_id, c.contact_id, i.kind, i.value, c.channel
  from public.conversations c, lateral public.channel_identity(c.channel, c.external_id) i
 where c.contact_id is not null
on conflict (organization_id, kind, value) do nothing;

-- ====================================================== merge (everything) ====
-- core merge, no permission check — called by merge_contacts_v2 (checks) and the
-- automatic identity resolution (service role)
create or replace function public.merge_contacts_core(p_org uuid, p_keep uuid, p_merge uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.contacts;
begin
  if p_keep = p_merge then
    raise exception 'same_contact' using errcode = '22023';
  end if;
  select * into m from public.contacts where id = p_merge and organization_id = p_org;
  if not found or not exists (select 1 from public.contacts where id = p_keep and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.notes         set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.tasks         set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.deals         set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.activities    set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.files         set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.conversations set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.appointments  set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.documents     set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.tickets       set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.form_submissions set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  delete from public.campaign_recipients r
   where r.organization_id = p_org and r.contact_id = p_merge
     and exists (select 1 from public.campaign_recipients k where k.campaign_id = r.campaign_id and k.contact_id = p_keep);
  update public.campaign_recipients set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  insert into public.contact_tags (organization_id, contact_id, tag_id)
    select organization_id, p_keep, tag_id from public.contact_tags where organization_id = p_org and contact_id = p_merge
    on conflict do nothing;
  -- identities of the merged contact now point at the kept one
  update public.contact_identities i set contact_id = p_keep
   where i.organization_id = p_org and i.contact_id = p_merge;

  delete from public.contacts where id = p_merge and organization_id = p_org;

  update public.contacts k set
    email        = coalesce(k.email, m.email),
    phone        = coalesce(k.phone, m.phone),
    company_id   = coalesce(k.company_id, m.company_id),
    company_name = coalesce(k.company_name, m.company_name),
    job_title    = coalesce(k.job_title, m.job_title),
    marketing_consent = k.marketing_consent or m.marketing_consent,
    custom_fields = m.custom_fields || k.custom_fields,
    updated_at   = now()
  where k.id = p_keep and k.organization_id = p_org;

  insert into public.activities (organization_id, contact_id, type, payload, actor_id)
  values (p_org, p_keep, 'contact.merged',
          jsonb_build_object('merged_id', p_merge, 'name', btrim(m.first_name || ' ' || m.last_name), 'auto', p_actor is null), p_actor);
  return p_keep;
end;
$$;
revoke all on function public.merge_contacts_core(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.merge_contacts_v2(p_org uuid, p_keep uuid, p_merge uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission(p_org, 'contacts.write') and public.has_permission(p_org, 'contacts.delete')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.merge_contacts_core(p_org, p_keep, p_merge, auth.uid());
end;
$$;
revoke all on function public.merge_contacts_v2(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_contacts_v2(uuid, uuid, uuid) to authenticated;

-- Automatic identity resolution: a contact that a CHANNEL created (no human creator)
-- and that shares a phone / e-mail with an OLDER contact is folded into it — as long
-- as nobody built anything on it yet (deals, documents, appointments, tickets).
create or replace function public.auto_merge_channel_duplicates(p_limit int default 50, p_org uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id as dup, c.organization_id as org,
           (select o.id from public.contacts o
             where o.organization_id = c.organization_id and o.id <> c.id and o.created_at < c.created_at
               and ((c.phone is not null and public.norm_phone(o.phone) = public.norm_phone(c.phone))
                    or (c.email is not null and lower(o.email::text) = lower(c.email::text)))
             order by o.created_at limit 1) as keep
      from public.contacts c
     where c.created_by is null
       and c.source in ('whatsapp', 'whatsapp_qr', 'telegram', 'telegram_user', 'sms', 'email', 'web', 'chat', 'web_chat')
       and (c.phone is not null or c.email is not null)
       and c.updated_at > now() - interval '3 days'
       and (p_org is null or c.organization_id = p_org)
       and not exists (select 1 from public.deals d where d.contact_id = c.id)
       and not exists (select 1 from public.documents d where d.contact_id = c.id)
       and not exists (select 1 from public.appointments a where a.contact_id = c.id)
       and not exists (select 1 from public.tickets t where t.contact_id = c.id)
     order by c.updated_at desc
     limit greatest(1, least(p_limit, 500))
  loop
    if r.keep is not null then
      begin
        perform public.merge_contacts_core(r.org, r.keep, r.dup, null);
        n := n + 1;
      exception when others then
        null; -- keep going; the other contact is still offered as a duplicate in the UI
      end;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.auto_merge_channel_duplicates(int, uuid) from public, anon, authenticated;

-- ======================================================== unified timeline ====
-- SECURITY INVOKER: every part goes through RLS (no inbox access → no messages, …)
create or replace function public.contact_timeline(p_org uuid, p_contact uuid, p_limit int default 80, p_before timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) from (
    select x from (
      select jsonb_build_object('kind', 'message', 'at', m.created_at, 'id', m.id, 'channel', c.channel, 'direction', m.direction,
                                'body', left(m.body, 600), 'conversation_id', c.id, 'ai', m.ai_agent_id is not null,
                                'owner', coalesce(m.meta ->> 'owner', '') = 'true', 'media', m.media ->> 'type') as x
        from public.messages m join public.conversations c on c.id = m.conversation_id
       where c.organization_id = p_org and c.contact_id = p_contact and (p_before is null or m.created_at < p_before)
      union all
      select jsonb_build_object('kind', 'note', 'at', n.created_at, 'id', n.id, 'body', left(n.body, 1200))
        from public.notes n where n.organization_id = p_org and n.contact_id = p_contact and (p_before is null or n.created_at < p_before)
      union all
      select jsonb_build_object('kind', 'activity', 'at', a.created_at, 'id', a.id, 'type', a.type, 'payload', a.payload)
        from public.activities a where a.organization_id = p_org and a.contact_id = p_contact and (p_before is null or a.created_at < p_before)
      union all
      select jsonb_build_object('kind', 'appointment', 'at', ap.starts_at, 'id', ap.id, 'title', ap.title, 'status', ap.status)
        from public.appointments ap where ap.organization_id = p_org and ap.contact_id = p_contact and (p_before is null or ap.starts_at < p_before)
      union all
      select jsonb_build_object('kind', 'document', 'at', coalesce(d.sent_at, d.created_at), 'id', d.id, 'doc_kind', d.kind,
                                'number', d.number, 'status', d.status, 'total', d.total, 'currency', d.currency)
        from public.documents d where d.organization_id = p_org and d.contact_id = p_contact and (p_before is null or coalesce(d.sent_at, d.created_at) < p_before)
      union all
      select jsonb_build_object('kind', 'ticket', 'at', t.created_at, 'id', t.id, 'number', t.number, 'title', t.subject, 'status', t.status)
        from public.tickets t where t.organization_id = p_org and t.contact_id = p_contact and (p_before is null or t.created_at < p_before)
      union all
      select jsonb_build_object('kind', 'form', 'at', f.created_at, 'id', f.id, 'form_id', f.form_id)
        from public.form_submissions f where f.organization_id = p_org and f.contact_id = p_contact and (p_before is null or f.created_at < p_before)
      union all
      select jsonb_build_object('kind', 'deal', 'at', d.created_at, 'id', d.id, 'title', d.title, 'status', d.status, 'total', d.value, 'currency', d.currency)
        from public.deals d where d.organization_id = p_org and d.contact_id = p_contact and (p_before is null or d.created_at < p_before)
    ) u
    order by (x ->> 'at') desc
    limit greatest(1, least(coalesce(p_limit, 80), 300))
  ) s;
$$;
revoke all on function public.contact_timeline(uuid, uuid, int, timestamptz) from public, anon;
grant execute on function public.contact_timeline(uuid, uuid, int, timestamptz) to authenticated;

-- ======================================================== insights / score ====
create table if not exists public.contact_insights (
  contact_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_score int check (lead_score is null or lead_score between 0 and 100),
  breakdown jsonb not null default '{}'::jsonb,
  sentiment text check (sentiment is null or sentiment in ('positive', 'neutral', 'negative')),
  stage text check (stage is null or stage in ('new', 'interested', 'considering', 'ready', 'customer', 'lost')),
  ai jsonb not null default '{}'::jsonb check (jsonb_typeof(ai) = 'object' and pg_column_size(ai) < 20000),
  last_inbound_at timestamptz,
  inbound_since_analysis int not null default 0,
  scored_at timestamptz,
  analyzed_at timestamptz,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index if not exists contact_insights_org_score on public.contact_insights (organization_id, lead_score desc nulls last);
alter table public.contact_insights enable row level security;
drop policy if exists contact_insights_read on public.contact_insights;
create policy contact_insights_read on public.contact_insights for select to authenticated
  using (public.has_permission(organization_id, 'contacts.read'));
revoke insert, update, delete on public.contact_insights from anon, authenticated;
grant select on public.contact_insights to authenticated;

-- inbound activity marks the contact for re-scoring (cheap, no AI)
create or replace function public.messages_touch_insights()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
begin
  if new.direction <> 'in' then return null; end if;
  select contact_id into cid from public.conversations where id = new.conversation_id;
  if cid is null then return null; end if;
  insert into public.contact_insights as ci (contact_id, organization_id, last_inbound_at, inbound_since_analysis)
  values (cid, new.organization_id, new.created_at, 1)
  on conflict (contact_id) do update set last_inbound_at = excluded.last_inbound_at,
                                         inbound_since_analysis = ci.inbound_since_analysis + 1;
  return null;
end;
$$;
drop trigger if exists messages_touch_insights on public.messages;
create trigger messages_touch_insights after insert on public.messages
  for each row execute function public.messages_touch_insights();

-- Rule-based lead score 0..100 with an explainable breakdown (no AI cost).
create or replace function public.compute_lead_score(p_contact uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c public.contacts;
  ci public.contact_insights;
  b jsonb := '{}'::jsonb;
  s int := 0;
  v int;
  hot text;
  inbound7 int;
  last_in timestamptz;
begin
  select * into c from public.contacts where id = p_contact;
  if not found then return null; end if;
  select * into ci from public.contact_insights where contact_id = p_contact;

  v := case c.status when 'customer' then 35 when 'qualified' then 25 when 'lead' then 10 else 0 end;
  b := b || jsonb_build_object('status', v); s := s + v;

  select max(case lead_score when 'hot' then 3 when 'warm' then 2 when 'cold' then 1 else 0 end) into v
    from public.conversations where contact_id = p_contact;
  v := case coalesce(v, 0) when 3 then 25 when 2 then 12 when 1 then 3 else 0 end;
  b := b || jsonb_build_object('ai_lead', v); s := s + v;

  select count(*) into inbound7 from public.messages m join public.conversations cv on cv.id = m.conversation_id
   where cv.contact_id = p_contact and m.direction = 'in' and m.created_at > now() - interval '7 days';
  v := least(15, coalesce(inbound7, 0) * 3);
  b := b || jsonb_build_object('engagement', v); s := s + v;

  select max(m.created_at) into last_in from public.messages m join public.conversations cv on cv.id = m.conversation_id
   where cv.contact_id = p_contact and m.direction = 'in';
  v := case when last_in is null then 0
            when last_in > now() - interval '1 day' then 10
            when last_in > now() - interval '7 days' then 5
            when last_in < now() - interval '30 days' then -10 else 0 end;
  b := b || jsonb_build_object('recency', v); s := s + v;

  v := 0;
  if exists (select 1 from public.deals where contact_id = p_contact and status = 'open') then v := v + 8; end if;
  if exists (select 1 from public.deals where contact_id = p_contact and status = 'won') then v := v + 12; end if;
  b := b || jsonb_build_object('deals', v); s := s + v;

  v := 0;
  if exists (select 1 from public.documents where contact_id = p_contact and kind = 'quote' and status = 'accepted') then v := v + 15;
  elsif exists (select 1 from public.documents where contact_id = p_contact and kind = 'quote' and viewed_at is not null and status = 'sent') then v := v + 8;
  elsif exists (select 1 from public.documents where contact_id = p_contact and kind = 'quote' and status = 'sent') then v := v + 4;
  end if;
  b := b || jsonb_build_object('quotes', v); s := s + v;

  v := case when exists (select 1 from public.appointments where contact_id = p_contact and starts_at > now() and status in ('scheduled', 'confirmed')) then 10 else 0 end;
  b := b || jsonb_build_object('meeting', v); s := s + v;

  v := case coalesce(ci.sentiment, '') when 'positive' then 5 when 'negative' then -15 else 0 end;
  b := b || jsonb_build_object('sentiment', v); s := s + v;

  v := (case when c.phone is not null then 3 else 0 end) + (case when c.email is not null then 2 else 0 end) + (case when c.marketing_consent then 2 else 0 end);
  b := b || jsonb_build_object('details', v); s := s + v;

  return jsonb_build_object('score', greatest(0, least(100, s)), 'breakdown', b);
end;
$$;
revoke all on function public.compute_lead_score(uuid) from public, anon, authenticated;

-- (re)score one contact — members with contacts.read; returns the stored insights
create or replace function public.refresh_contact_score(p_org uuid, p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  ci public.contact_insights;
begin
  if auth.uid() is not null and not public.has_permission(p_org, 'contacts.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  r := public.compute_lead_score(p_contact);
  insert into public.contact_insights as x (contact_id, organization_id, lead_score, breakdown, scored_at)
  values (p_contact, p_org, (r ->> 'score')::int, r -> 'breakdown', now())
  on conflict (contact_id) do update set lead_score = excluded.lead_score, breakdown = excluded.breakdown, scored_at = now()
  returning * into ci;
  return to_jsonb(ci);
end;
$$;
revoke all on function public.refresh_contact_score(uuid, uuid) from public, anon;
grant execute on function public.refresh_contact_score(uuid, uuid) to authenticated, service_role;

-- AI analysis result (server only — the app validated the JSON)
create or replace function public.save_contact_ai_insights(p_org uuid, p_contact uuid, p_ai jsonb, p_sentiment text, p_stage text, p_ai_score int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  rule int;
  final int;
  ci public.contact_insights;
begin
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- sentiment first, so the rule score sees it
  insert into public.contact_insights as x (contact_id, organization_id, sentiment)
  values (p_contact, p_org, case when p_sentiment in ('positive', 'neutral', 'negative') then p_sentiment end)
  on conflict (contact_id) do update set sentiment = coalesce(excluded.sentiment, x.sentiment);
  r := public.compute_lead_score(p_contact);
  rule := (r ->> 'score')::int;
  final := case when p_ai_score between 0 and 100 then round(rule * 0.5 + p_ai_score * 0.5)::int else rule end;
  update public.contact_insights set
    lead_score = greatest(0, least(100, final)),
    breakdown = (r -> 'breakdown') || jsonb_build_object('ai', p_ai_score),
    stage = case when p_stage in ('new', 'interested', 'considering', 'ready', 'customer', 'lost') then p_stage else stage end,
    ai = coalesce(p_ai, '{}'::jsonb),
    scored_at = now(), analyzed_at = now(), inbound_since_analysis = 0
  where contact_id = p_contact
  returning * into ci;
  insert into public.activities (organization_id, contact_id, type, payload)
  values (p_org, p_contact, 'contact.analyzed', jsonb_build_object('score', ci.lead_score, 'sentiment', ci.sentiment, 'stage', ci.stage));
  return to_jsonb(ci);
end;
$$;
revoke all on function public.save_contact_ai_insights(uuid, uuid, jsonb, text, text, int) from public, anon, authenticated;

-- cron: re-score contacts with fresh activity (rule-based, cheap)
create or replace function public.refresh_stale_scores(p_limit int default 200)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n int := 0;
  s jsonb;
begin
  for r in
    select ci.contact_id, ci.organization_id from public.contact_insights ci
     where ci.last_inbound_at is not null and (ci.scored_at is null or ci.scored_at < ci.last_inbound_at)
     order by ci.last_inbound_at desc
     limit greatest(1, least(p_limit, 1000))
  loop
    s := public.compute_lead_score(r.contact_id);
    if s is not null then
      update public.contact_insights set lead_score = (s ->> 'score')::int, breakdown = s -> 'breakdown', scored_at = now()
       where contact_id = r.contact_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.refresh_stale_scores(int) from public, anon, authenticated;

-- ===================================================== stage automation ====
alter table public.pipeline_stages add column if not exists auto_on text[] not null default '{}'::text[];
alter table public.pipeline_stages add column if not exists marks_won boolean not null default false;
do $$ begin
  alter table public.pipeline_stages add constraint pipeline_stages_auto_on_check check (auto_on <@ array[
    'quote_sent', 'quote_viewed', 'quote_accepted', 'contract_signed', 'deposit_paid', 'invoice_paid',
    'appointment_booked', 'ai_lead', 'ai_lead_hot', 'form_submitted']::text[]);
exception when duplicate_object then null; end $$;

-- move one open deal forward to the first later stage that listens to the event
create or replace function public.advance_deal(p_deal uuid, p_event text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.deals;
  cur int;
  ns public.pipeline_stages;
begin
  select * into d from public.deals where id = p_deal and status = 'open';
  if not found then return false; end if;
  select position into cur from public.pipeline_stages where id = d.stage_id;
  select * into ns from public.pipeline_stages s
   where s.pipeline_id = d.pipeline_id and p_event = any (s.auto_on) and s.position > coalesce(cur, -1)
   order by s.position asc limit 1;
  if not found then return false; end if;
  update public.deals set stage_id = ns.id,
         status = case when ns.marks_won then 'won'::public.deal_status else status end,
         closed_at = case when ns.marks_won then now() else closed_at end
   where id = d.id;
  insert into public.activities (organization_id, contact_id, deal_id, type, payload)
  values (d.organization_id, d.contact_id, d.id, 'deal.auto_stage',
          jsonb_build_object('event', p_event, 'from', d.stage_id, 'to', ns.id, 'stage', ns.name, 'won', ns.marks_won));
  return true;
end;
$$;
revoke all on function public.advance_deal(uuid, text) from public, anon, authenticated;

-- the deal an event belongs to: explicit deal, else the contact's latest open deal
create or replace function public.advance_contact_deals(p_org uuid, p_contact uuid, p_deal uuid, p_event text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := p_deal;
begin
  if target is null and p_contact is not null then
    select id into target from public.deals
     where organization_id = p_org and contact_id = p_contact and status = 'open'
     order by updated_at desc limit 1;
  end if;
  if target is null then return 0; end if;
  return case when public.advance_deal(target, p_event) then 1 else 0 end;
end;
$$;
revoke all on function public.advance_contact_deals(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ================================================ documents: contracts ====
alter table public.documents add column if not exists require_signature boolean not null default false;
alter table public.documents add column if not exists contract_terms text;
alter table public.documents add column if not exists signature_data text;
alter table public.documents add column if not exists signed_at timestamptz;
alter table public.documents add column if not exists signer_meta jsonb;
alter table public.documents add column if not exists content_hash text;
alter table public.documents add column if not exists viewed_at timestamptz;
alter table public.documents add column if not exists view_count int not null default 0;
do $$ begin
  alter table public.documents add constraint documents_contract_terms_len check (contract_terms is null or char_length(contract_terms) <= 20000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.documents add constraint documents_signature_format
    check (signature_data is null or (signature_data ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and char_length(signature_data) <= 300000));
exception when duplicate_object then null; end $$;

-- a signed document can no longer be edited (amounts, lines, terms)
create or replace function public.guard_signed_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.signed_at is not null and auth.uid() is not null and (
       new.total is distinct from old.total or new.contract_terms is distinct from old.contract_terms
       or new.title is distinct from old.title or new.signature_data is distinct from old.signature_data
       or new.signed_at is distinct from old.signed_at or new.content_hash is distinct from old.content_hash) then
    raise exception 'document_signed' using errcode = 'P0001';
  end if;
  if auth.uid() is not null and old.signed_at is null and (new.signature_data is distinct from old.signature_data or new.signed_at is distinct from old.signed_at or new.content_hash is distinct from old.content_hash) then
    raise exception 'protected document column' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_signed_guard on public.documents;
create trigger documents_signed_guard before update on public.documents
  for each row execute function public.guard_signed_document();

create or replace function public.document_lines_signed_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  did uuid := coalesce(new.document_id, old.document_id);
begin
  if auth.uid() is not null and exists (select 1 from public.documents where id = did and signed_at is not null) then
    raise exception 'document_signed' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists document_lines_signed_guard on public.document_lines;
create trigger document_lines_signed_guard before insert or update or delete on public.document_lines
  for each row execute function public.document_lines_signed_guard();

-- canonical content of a document → sha-256 (shown on the document; proves it was not changed)
create or replace function public.document_content_hash(p_doc uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(
    d.kind || '|' || d.number || '|' || coalesce(d.title, '') || '|' || d.currency || '|' || d.total::text || '|' ||
    coalesce(d.contract_terms, '') || '|' ||
    coalesce((select string_agg(l.description || ':' || l.quantity::text || ':' || l.unit_price::text || ':' || l.discount_pct::text || ':' || l.tax_rate::text, ';' order by l.position)
                from public.document_lines l where l.document_id = d.id), ''),
    'sha256'), 'hex')
  from public.documents d where d.id = p_doc;
$$;
revoke all on function public.document_content_hash(uuid) from public, anon, authenticated;

-- public: the customer opened the document (once per visitor per hour)
create or replace function public.track_document_view(p_token text, p_visitor text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
  first boolean;
begin
  select * into d from public.documents where public_token = p_token and status <> 'draft';
  if not found then return; end if;
  if not public.public_rate_limit('docview:' || d.id || ':' || coalesce(left(p_visitor, 64), 'anon'), 1, 3600) then return; end if;
  first := d.viewed_at is null;
  update public.documents set view_count = view_count + 1, viewed_at = coalesce(viewed_at, now()) where id = d.id;
  if first then
    if d.contact_id is not null then
      insert into public.activities (organization_id, contact_id, deal_id, type, payload)
      values (d.organization_id, d.contact_id, d.deal_id, 'document.viewed', jsonb_build_object('document_id', d.id, 'number', d.number, 'kind', d.kind));
    end if;
    insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
    select d.organization_id, m.user_id, 'finance', 'finance.viewedNotification', jsonb_build_object('number', d.number), '/finance/' || d.id
      from public.organization_members m where m.organization_id = d.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'sales');
    if d.kind = 'quote' then
      perform public.advance_contact_deals(d.organization_id, d.contact_id, d.deal_id, 'quote_viewed');
    end if;
  end if;
end;
$$;
revoke all on function public.track_document_view(text, text) from public;
grant execute on function public.track_document_view(text, text) to anon, authenticated, service_role;

-- public: accept a quote with a drawn signature (contract)
create or replace function public.sign_public_quote(p_token text, p_name text, p_signature text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
  h text;
begin
  if btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'finance.nameRequired');
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) > 300000 or char_length(p_signature) < 200 then
    return jsonb_build_object('ok', false, 'error', 'finance.sign.required');
  end if;
  select * into d from public.documents
   where public_token = p_token and kind = 'quote' and status = 'sent' and signed_at is null
     and (due_date is null or due_date >= current_date)
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'finance.cannotAccept');
  end if;
  if not public.public_rate_limit('sign:' || d.id, 5, 3600) then
    return jsonb_build_object('ok', false, 'error', 'errors.rateLimited');
  end if;
  h := public.document_content_hash(d.id);
  update public.documents
     set status = 'accepted', accepted_at = now(), accepted_by_name = left(btrim(p_name), 120),
         signature_data = p_signature, signed_at = now(), content_hash = h,
         signer_meta = jsonb_build_object('ip_hash', left(coalesce(p_meta ->> 'ip_hash', ''), 64), 'ua', left(coalesce(p_meta ->> 'ua', ''), 300), 'at', now())
   where id = d.id;
  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  select d.organization_id, m.user_id, 'finance', 'finance.signedNotification', jsonb_build_object('number', d.number, 'name', left(btrim(p_name), 120)), '/finance/' || d.id
    from public.organization_members m where m.organization_id = d.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'sales');
  if d.contact_id is not null then
    insert into public.activities (organization_id, contact_id, deal_id, type, payload)
    values (d.organization_id, d.contact_id, d.deal_id, 'quote.signed', jsonb_build_object('document_id', d.id, 'number', d.number, 'total', d.total, 'hash', h));
  end if;
  perform public.advance_contact_deals(d.organization_id, d.contact_id, d.deal_id, 'contract_signed');
  return jsonb_build_object('ok', true, 'hash', h);
end;
$$;
revoke all on function public.sign_public_quote(text, text, text, jsonb) from public;
grant execute on function public.sign_public_quote(text, text, text, jsonb) to anon, authenticated, service_role;

-- quotes with "signature required" cannot be accepted with a typed name only
create or replace function public.guard_accept_without_signature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'quote' and new.status = 'accepted' and old.status <> 'accepted'
     and old.require_signature and new.signed_at is null then
    raise exception 'signature_required' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_signature_required on public.documents;
create trigger documents_signature_required before update of status on public.documents
  for each row execute function public.guard_accept_without_signature();

-- document status → pipeline events
create or replace function public.documents_stage_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    if new.kind = 'quote' and new.status = 'sent' then
      perform public.advance_contact_deals(new.organization_id, new.contact_id, new.deal_id, 'quote_sent');
    elsif new.kind = 'quote' and new.status = 'accepted' then
      perform public.advance_contact_deals(new.organization_id, new.contact_id, new.deal_id, 'quote_accepted');
    elsif new.kind = 'invoice' and new.status = 'paid' then
      perform public.advance_contact_deals(new.organization_id, new.contact_id, new.deal_id, 'invoice_paid');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists documents_stage_events on public.documents;
create trigger documents_stage_events after update of status on public.documents
  for each row execute function public.documents_stage_events();

-- public document v2: everything of v1 + contract, signature and payment options
create or replace function public.get_public_document_v2(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
  base jsonb;
begin
  base := public.get_public_document(p_token);
  if base is null then return null; end if;
  select * into d from public.documents where public_token = p_token;
  return base || jsonb_build_object(
    'require_signature', d.require_signature,
    'contract_terms', d.contract_terms,
    'signed_at', d.signed_at,
    'signature', d.signature_data,
    'content_hash', d.content_hash,
    'paypal', exists (select 1 from public.finance_settings s where s.organization_id = d.organization_id and s.paypal_client_id is not null and s.paypal_secret_enc is not null),
    'stripe', exists (select 1 from public.finance_settings s where s.organization_id = d.organization_id and s.stripe_secret_enc is not null and s.stripe_webhook_secret_enc is not null),
    'balance', greatest(0, d.total - d.amount_paid));
end;
$$;
revoke all on function public.get_public_document_v2(text) from public;
grant execute on function public.get_public_document_v2(text) to anon, authenticated, service_role;

-- ============================================== payments: PayPal + invoicing ====
alter table public.finance_settings add column if not exists paypal_client_id text;
alter table public.finance_settings add column if not exists paypal_secret_enc text;
alter table public.finance_settings add column if not exists paypal_mode text not null default 'live';
do $$ begin
  alter table public.finance_settings add constraint finance_settings_paypal_mode check (paypal_mode in ('live', 'sandbox'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.finance_settings add constraint finance_settings_paypal_client_len check (paypal_client_id is null or paypal_client_id ~ '^[A-Za-z0-9_-]{10,200}$');
exception when duplicate_object then null; end $$;

-- the client id and mode are not secret (the PayPal secret stays unreadable, like Stripe's)
grant select (paypal_client_id, paypal_mode) on public.finance_settings to authenticated;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.payments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%method%'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'transfer', 'card', 'check', 'bit', 'paybox', 'stripe', 'paypal', 'other'));
alter table public.payments add column if not exists invoice_ref jsonb;

-- service role: online payment confirmed by the business's own PayPal / Stripe
create or replace function public.record_online_payment_v2(p_token text, p_amount numeric, p_external_id text, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  if p_method not in ('stripe', 'paypal') then
    raise exception 'bad_method' using errcode = '22023';
  end if;
  select * into d from public.documents where public_token = p_token and kind = 'invoice';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'bad_amount' using errcode = '22023';
  end if;
  insert into public.payments (organization_id, document_id, amount, method, reference, external_id)
  values (d.organization_id, d.id, p_amount, p_method, initcap(p_method) || ' ' || p_external_id, p_external_id)
  on conflict (external_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.record_online_payment_v2(text, numeric, text, text) from public, anon, authenticated;

-- every payment: deposit → pipeline event; queue the tax document (Morning / iCount)
create or replace function public.payments_after_wave15()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = new.document_id;
  -- order-independent: sum the payments instead of relying on amount_paid being updated already
  if found and (select coalesce(sum(p.amount), 0) from public.payments p where p.document_id = d.id) < d.total then
    perform public.advance_contact_deals(d.organization_id, d.contact_id, d.deal_id, 'deposit_paid');
  end if;
  if exists (select 1 from public.integrations i
              where i.organization_id = new.organization_id and i.provider in ('morning', 'icount')
                and i.status = 'active' and coalesce((i.config ->> 'auto')::boolean, true))
     and public.has_feature(new.organization_id, 'invoicing_sync') then
    insert into public.jobs (organization_id, kind, payload)
    values (new.organization_id, 'invoice', jsonb_build_object('payment_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists payments_after_wave15 on public.payments;
create trigger payments_after_wave15 after insert on public.payments
  for each row execute function public.payments_after_wave15();

-- ============================================================ task reminders ====
alter table public.tasks add column if not exists remind_at timestamptz;
alter table public.tasks add column if not exists reminded_at timestamptz;
alter table public.tasks add column if not exists snooze_count int not null default 0;
create index if not exists tasks_remind_due on public.tasks (remind_at) where remind_at is not null and reminded_at is null;

alter table public.notify_recipients add column if not exists user_id uuid references auth.users (id) on delete cascade;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.notify_recipients'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%events%'
  loop
    execute format('alter table public.notify_recipients drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.notify_recipients add constraint notify_recipients_events_check
  check (events <@ array['messages', 'leads', 'handoff', 'daily', 'tasks', 'escalation', 'appointments']::text[]);
create index if not exists notify_recipients_user on public.notify_recipients (organization_id, user_id) where user_id is not null;

-- every member manages HIS OWN personal channels (task reminders, meetings, urgent calls)
drop policy if exists notify_recipients_self_select on public.notify_recipients;
create policy notify_recipients_self_select on public.notify_recipients for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy if exists notify_recipients_self_insert on public.notify_recipients;
create policy notify_recipients_self_insert on public.notify_recipients for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy if exists notify_recipients_self_update on public.notify_recipients;
create policy notify_recipients_self_update on public.notify_recipients for update to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy if exists notify_recipients_self_delete on public.notify_recipients;
create policy notify_recipients_self_delete on public.notify_recipients for delete to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

-- workspace recipients: still at most 20; personal channels: at most 6 per member (separate)
create or replace function public.notify_recipients_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is null then
    if (select count(*) from public.notify_recipients where organization_id = new.organization_id and user_id is null) >= 20 then
      raise exception 'plan_limit:notify_recipients' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.notify_recipients where organization_id = new.organization_id and user_id = new.user_id) >= 6 then
    raise exception 'plan_limit:notify_recipients' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- due reminders, claimed atomically (no double send between overlapping cron runs)
create or replace function public.claim_task_reminders(p_limit int default 50)
returns table (task_id uuid, organization_id uuid, assignee_id uuid, title text, due_at timestamptz, contact_id uuid, contact_name text, snooze_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select t.id from public.tasks t
     where t.remind_at is not null and t.remind_at <= now() and t.reminded_at is null
       and t.status in ('open', 'in_progress') and t.assignee_id is not null
     order by t.remind_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  ), upd as (
    update public.tasks t set reminded_at = now() from due where t.id = due.id
    returning t.id, t.organization_id, t.assignee_id, t.title, t.due_at, t.contact_id, t.snooze_count
  )
  select u.id, u.organization_id, u.assignee_id, u.title, u.due_at, u.contact_id,
         (select btrim(c.first_name || ' ' || c.last_name) from public.contacts c where c.id = u.contact_id), u.snooze_count
    from upd u;
end;
$$;
revoke all on function public.claim_task_reminders(int) from public, anon, authenticated;

-- "done" / "snooze" from a reminder (Telegram button or signed link) — server only
create or replace function public.task_reminder_action(p_task uuid, p_user uuid, p_action text, p_minutes int default 15)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task and assignee_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action = 'done' then
    if t.status in ('done', 'canceled') then return jsonb_build_object('ok', true, 'already', true, 'title', t.title); end if;
    update public.tasks set status = 'done' where id = t.id;
  elsif p_action = 'snooze' then
    if t.status in ('done', 'canceled') then return jsonb_build_object('ok', false, 'error', 'closed', 'title', t.title); end if;
    update public.tasks set remind_at = now() + make_interval(mins => greatest(5, least(coalesce(p_minutes, 15), 1440))),
                            reminded_at = null, snooze_count = snooze_count + 1
     where id = t.id;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  insert into public.activities (organization_id, contact_id, deal_id, type, payload, actor_id)
  values (t.organization_id, t.contact_id, t.deal_id, 'task.' || p_action || '_from_reminder', jsonb_build_object('task_id', t.id, 'title', t.title), p_user);
  return jsonb_build_object('ok', true, 'title', t.title);
end;
$$;
revoke all on function public.task_reminder_action(uuid, uuid, text, int) from public, anon, authenticated;

-- =============================================================== lead routing ====
alter table public.organizations add column if not exists lead_routing jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.organizations add constraint organizations_lead_routing_object check (jsonb_typeof(lead_routing) = 'object' and pg_column_size(lead_routing) < 20000);
exception when duplicate_object then null; end $$;
alter table public.organization_members add column if not exists available boolean not null default true;

create table if not exists public.routing_state (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  counter bigint not null default 0,
  last_user uuid,
  updated_at timestamptz not null default now()
);
alter table public.routing_state enable row level security;
revoke all on public.routing_state from anon, authenticated;

-- next team member for a new lead / conversation (null = routing off or nobody available)
create or replace function public.next_assignee(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  mode text;
  cand uuid[];
  st public.routing_state;
  pick uuid;
begin
  select lead_routing into r from public.organizations where id = p_org;
  mode := coalesce(r ->> 'mode', 'off');
  if mode not in ('round_robin', 'least_loaded') or not public.has_feature(p_org, 'lead_routing') then return null; end if;
  select coalesce(array_agg(m.user_id order by m.created_at, m.user_id), '{}') into cand
    from public.organization_members m
   where m.organization_id = p_org and m.available
     and m.role not in ('read_only', 'client', 'analyst')
     and (coalesce(jsonb_typeof(r -> 'members'), 'null') <> 'array' or jsonb_array_length(r -> 'members') = 0
          or m.user_id::text in (select jsonb_array_elements_text(r -> 'members')));
  if cardinality(cand) = 0 then return null; end if;
  if mode = 'least_loaded' then
    select u into pick from unnest(cand) with ordinality as x(u, ord)
     order by (select count(*) from public.conversations c where c.organization_id = p_org and c.assignee_id = x.u and c.status = 'open')
              + (select count(*) from public.contacts c where c.organization_id = p_org and c.owner_id = x.u and c.created_at > now() - interval '7 days'),
              x.ord
     limit 1;
  else
    insert into public.routing_state (organization_id) values (p_org) on conflict do nothing;
    select * into st from public.routing_state where organization_id = p_org for update;
    pick := cand[(st.counter % cardinality(cand)) + 1];
    update public.routing_state set counter = counter + 1, last_user = pick, updated_at = now() where organization_id = p_org;
  end if;
  return pick;
end;
$$;
revoke all on function public.next_assignee(uuid) from public, anon, authenticated;

create or replace function public.contacts_route_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
begin
  if new.owner_id is not null or new.created_by is not null or coalesce(new.is_demo, false) then return new; end if;
  select lead_routing into r from public.organizations where id = new.organization_id;
  if coalesce(r ->> 'mode', 'off') = 'off' or coalesce((r ->> 'contacts')::boolean, true) = false then return new; end if;
  new.owner_id := public.next_assignee(new.organization_id);
  return new;
end;
$$;
drop trigger if exists contacts_route_owner on public.contacts;
create trigger contacts_route_owner before insert on public.contacts
  for each row execute function public.contacts_route_owner();

create or replace function public.conversations_route_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  owner uuid;
begin
  if new.assignee_id is not null then return new; end if;
  -- an upsert of an existing conversation also fires BEFORE INSERT: do not route it again
  if exists (select 1 from public.conversations c where c.organization_id = new.organization_id and c.channel = new.channel and c.external_id = new.external_id) then
    return new;
  end if;
  select lead_routing into r from public.organizations where id = new.organization_id;
  if coalesce(r ->> 'mode', 'off') = 'off' or coalesce((r ->> 'conversations')::boolean, false) = false
     or not public.has_feature(new.organization_id, 'lead_routing') then return new; end if;
  if new.contact_id is not null then
    select c.owner_id into owner from public.contacts c
      join public.organization_members m on m.organization_id = c.organization_id and m.user_id = c.owner_id and m.available
     where c.id = new.contact_id;
  end if;
  new.assignee_id := coalesce(owner, public.next_assignee(new.organization_id));
  return new;
end;
$$;
drop trigger if exists conversations_route_assignee on public.conversations;
create trigger conversations_route_assignee before insert on public.conversations
  for each row execute function public.conversations_route_assignee();

-- tell the member a lead was routed to them
create or replace function public.notify_routed_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is not null and new.created_by is null and (tg_op = 'INSERT') then
    insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
    values (new.organization_id, new.owner_id, 'routing', 'routing.assignedNotification',
            jsonb_build_object('name', btrim(new.first_name || ' ' || new.last_name)), '/crm/' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists contacts_notify_routed on public.contacts;
create trigger contacts_notify_routed after insert on public.contacts
  for each row execute function public.notify_routed_owner();

-- other pipeline events: meetings and AI leads
create or replace function public.appointments_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.contact_id is not null and new.status in ('scheduled', 'confirmed') then
    perform public.advance_contact_deals(new.organization_id, new.contact_id, null, 'appointment_booked');
  end if;
  return null;
end;
$$;
drop trigger if exists appointments_stage_event on public.appointments;
create trigger appointments_stage_event after insert on public.appointments
  for each row execute function public.appointments_stage_event();

create or replace function public.conversations_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.lead_score is not null and new.lead_score is distinct from old.lead_score then
    perform public.advance_contact_deals(new.organization_id, new.contact_id, new.deal_id, 'ai_lead');
    if new.lead_score = 'hot' then
      perform public.advance_contact_deals(new.organization_id, new.contact_id, new.deal_id, 'ai_lead_hot');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists conversations_stage_event on public.conversations;
create trigger conversations_stage_event after update of lead_score on public.conversations
  for each row execute function public.conversations_stage_event();

create or replace function public.forms_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.contact_id is not null then
    perform public.advance_contact_deals(new.organization_id, new.contact_id, null, 'form_submitted');
  end if;
  return null;
end;
$$;
drop trigger if exists form_submissions_stage_event on public.form_submissions;
create trigger form_submissions_stage_event after insert on public.form_submissions
  for each row execute function public.forms_stage_event();

-- ------------------------------------------------------------ service grants ----
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.contact_identities, public.contact_insights, public.routing_state to service_role';
    execute 'grant execute on function public.merge_contacts_core(uuid, uuid, uuid, uuid), public.auto_merge_channel_duplicates(int, uuid),
      public.compute_lead_score(uuid), public.save_contact_ai_insights(uuid, uuid, jsonb, text, text, int), public.refresh_stale_scores(int),
      public.advance_deal(uuid, text), public.advance_contact_deals(uuid, uuid, uuid, text), public.document_content_hash(uuid),
      public.record_online_payment_v2(text, numeric, text, text), public.claim_task_reminders(int),
      public.task_reminder_action(uuid, uuid, text, int), public.next_assignee(uuid) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
