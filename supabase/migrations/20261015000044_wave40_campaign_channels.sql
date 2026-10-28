-- ============================================================================
-- Wave 40 — campaigns on Facebook Messenger and Instagram Direct (additive only).
-- Meta only lets a page message people who already wrote to it, so these two channels reach contacts that have an
-- existing conversation on that channel. Consent (marketing_consent), opt-out and STOP rules are unchanged.
-- ============================================================================

-- campaigns.channel: the four original channels + messenger + instagram
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.campaigns'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%channel%' loop
    execute format('alter table public.campaigns drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.campaigns add constraint campaigns_channel_check
  check (channel in ('email', 'whatsapp', 'sms', 'telegram', 'messenger', 'instagram'));

-- campaign messages are queued as jobs of the channel's kind: superset of the previous list
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_kind_check check (kind in (
  'email', 'webhook', 'http', 'whatsapp', 'telegram', 'sms', 'action',
  'invoice', 'conversion', 'push', 'calendar', 'reminder', 'call',
  'messenger', 'instagram'));

-- audience: identical to wave 17, plus the two Meta channels (an existing conversation is required)
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
           when 'messenger' then exists (select 1 from public.conversations mv where mv.contact_id = c.id and mv.organization_id = p_org and mv.channel = 'messenger')
           when 'instagram' then exists (select 1 from public.conversations iv where iv.contact_id = c.id and iv.organization_id = p_org and iv.channel = 'instagram')
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
