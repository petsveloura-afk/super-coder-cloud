-- ============================================================================
-- SUPER CODER CLOUD — 0024 AI sales agent: the agent closes the lead end-to-end.
--   • agent business profile (who it is, what it sells, hours, goal, tone)
--   • lead capture tool: contact + score tags + qualified status + deal +
--     follow-up task + summary note + team notification — in one call
--   • automatic follow-ups when a customer stops answering
--   • conversation lead fields (score, summary, deal) for the inbox / stats
-- Additive only.
-- ============================================================================

-- ------------------------------------------------------------ agents
alter table public.ai_agents add column if not exists profile jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.ai_agents add constraint ai_agents_profile_object check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 20000);
exception when duplicate_object then null; end $$;
alter table public.ai_agents add column if not exists followup_hours int not null default 0;
do $$ begin
  alter table public.ai_agents add constraint ai_agents_followup_hours_check check (followup_hours between 0 and 168);
exception when duplicate_object then null; end $$;
alter table public.ai_agents add column if not exists lead_goal text not null default 'lead';
do $$ begin
  alter table public.ai_agents add constraint ai_agents_lead_goal_check check (lead_goal in ('lead', 'booking', 'sale', 'support'));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ conversations
alter table public.conversations add column if not exists lead_score text;
do $$ begin
  alter table public.conversations add constraint conversations_lead_score_check check (lead_score is null or lead_score in ('hot', 'warm', 'cold'));
exception when duplicate_object then null; end $$;
alter table public.conversations add column if not exists lead_at timestamptz;
alter table public.conversations add column if not exists summary text;
do $$ begin
  alter table public.conversations add constraint conversations_summary_len check (summary is null or char_length(summary) <= 2000);
exception when duplicate_object then null; end $$;
alter table public.conversations add column if not exists deal_id uuid;
do $$ begin
  alter table public.conversations add constraint conversations_deal_fk foreign key (organization_id, deal_id)
    references public.deals (organization_id, id) on delete set null (deal_id);
exception when duplicate_object then null; when undefined_object then null; when invalid_foreign_key then
  alter table public.conversations add constraint conversations_deal_fk foreign key (deal_id) references public.deals (id) on delete set null;
end $$;
alter table public.conversations add column if not exists followup_count int not null default 0;
alter table public.conversations add column if not exists last_ai_at timestamptz;
create index if not exists conversations_followup_idx on public.conversations (last_message_at) where ai_mode = 'auto' and status = 'open';

-- ------------------------------------------------------------ lead capture tool
-- p_data: { name, phone, email, need, budget, score: hot|warm|cold, summary }
create or replace function public.ai_capture_lead(p_conv uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  conv public.conversations;
  c public.contacts;
  cid uuid;
  nm text := nullif(left(btrim(coalesce(p_data ->> 'name', '')), 120), '');
  em text := nullif(lower(btrim(coalesce(p_data ->> 'email', ''))), '');
  ph text := nullif(regexp_replace(coalesce(p_data ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
  need text := nullif(left(btrim(coalesce(p_data ->> 'need', '')), 160), '');
  v_summary text := nullif(left(btrim(coalesce(p_data ->> 'summary', '')), 2000), '');
  score text := lower(coalesce(p_data ->> 'score', ''));
  budget numeric := 0;
  first_lead boolean;
  pid uuid;
  sid uuid;
  did uuid;
  tag_name text;
  tid uuid;
  assignee uuid;
begin
  select * into conv from public.conversations where id = p_conv;
  if conv.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if score not in ('hot', 'warm', 'cold') then score := 'warm'; end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em := null; end if;
  if ph is not null and ph !~ '^\+?[0-9]{7,15}$' then ph := null; end if;
  begin
    budget := greatest(0, least(coalesce(nullif(regexp_replace(coalesce(p_data ->> 'budget', ''), '[^0-9.]', '', 'g'), '')::numeric, 0), 1000000000));
  exception when others then budget := 0;
  end;
  first_lead := conv.lead_at is null;

  -- 1. contact: link / create / enrich
  cid := conv.contact_id;
  if cid is null and (em is not null or ph is not null) then
    begin
      cid := public.upsert_public_contact(conv.organization_id, coalesce(nm, conv.title), em, ph, 'ai_' || conv.channel, false, '{}'::jsonb);
    exception when others then cid := null;
    end;
  end if;
  if cid is null then
    begin
      insert into public.contacts (organization_id, first_name, last_name, source)
      values (conv.organization_id, left(split_part(coalesce(nm, conv.title, 'Lead'), ' ', 1), 80),
              left(btrim(substr(coalesce(nm, conv.title, ''), length(split_part(coalesce(nm, conv.title, ''), ' ', 1)) + 1)), 80),
              left('ai_' || conv.channel, 40))
      returning id into cid;
    exception when others then cid := null; -- plan limit: keep going without a contact
    end;
  end if;
  if cid is not null then
    if conv.contact_id is null then
      update public.conversations set contact_id = cid where id = conv.id;
    end if;
    select * into c from public.contacts where id = cid;
    update public.contacts
       set phone = coalesce(phone, ph),
           email = coalesce(email, em::citext),
           first_name = case when nm is not null and (first_name = '' or first_name ~ '^(Telegram|Website|\+?[0-9])') then left(split_part(nm, ' ', 1), 80) else first_name end,
           last_name = case when nm is not null and (c.first_name = '' or c.first_name ~ '^(Telegram|Website|\+?[0-9])') then left(btrim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), 80) else last_name end,
           status = case when score in ('hot', 'warm') and status = 'lead' then 'qualified'::public.contact_status else status end,
           updated_at = now()
     where id = cid;

    -- 2. tags: ai-lead + score
    foreach tag_name in array array['ai-lead', 'lead-' || score] loop
      insert into public.tags (organization_id, name, color)
      values (conv.organization_id, tag_name, case tag_name when 'lead-hot' then '#E5484D' when 'lead-warm' then '#F5A524' when 'lead-cold' then '#3E8EF7' else '#8E4EC6' end)
      on conflict (organization_id, name) do nothing;
      select id into tid from public.tags where organization_id = conv.organization_id and name = tag_name;
      insert into public.contact_tags (organization_id, contact_id, tag_id) values (conv.organization_id, cid, tid) on conflict do nothing;
    end loop;
    delete from public.contact_tags ct using public.tags t
     where ct.tag_id = t.id and ct.contact_id = cid and t.name like 'lead-%' and t.name <> 'lead-' || score;
  end if;

  -- 3. deal (hot / warm, once per conversation) in the default pipeline's first stage
  did := conv.deal_id;
  if did is null and score in ('hot', 'warm') then
    select id into pid from public.pipelines where organization_id = conv.organization_id order by is_default desc, created_at limit 1;
    if pid is not null then
      select id into sid from public.pipeline_stages where pipeline_id = pid order by position limit 1;
      if sid is not null then
        begin
          insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value, owner_id)
          values (conv.organization_id, pid, sid, cid, left(coalesce(need, nm, conv.title, 'Lead') || ' · AI', 200), budget, conv.assignee_id)
          returning id into did;
        exception when others then did := null;
        end;
      end if;
    end if;
  end if;

  -- 4. summary note + follow-up task for the team (first capture only for the task)
  if cid is not null and v_summary is not null then
    insert into public.notes (organization_id, contact_id, deal_id, body)
    values (conv.organization_id, cid, did, left('🤖 ' || v_summary, 10000));
  end if;
  select coalesce(conv.assignee_id, (select m.user_id from public.organization_members m
                                       where m.organization_id = conv.organization_id
                                       order by case m.role when 'owner' then 0 when 'agency_owner' then 1 when 'admin' then 2 when 'sales' then 3 else 9 end, m.created_at limit 1))
    into assignee;
  if first_lead and score in ('hot', 'warm') then
    begin
      insert into public.tasks (organization_id, contact_id, deal_id, title, description, due_at, assignee_id)
      values (conv.organization_id, cid, did,
              left(case score when 'hot' then '🔥 ' else '' end || 'Follow up: ' || coalesce(nm, conv.title, 'lead'), 200),
              left(coalesce(v_summary, need, ''), 5000),
              now() + case score when 'hot' then interval '1 hour' else interval '1 day' end,
              assignee);
    exception when others then null;
    end;
  end if;

  update public.conversations
     set lead_score = score, lead_at = coalesce(lead_at, now()), summary = coalesce(v_summary, public.conversations.summary), deal_id = coalesce(did, deal_id)
   where id = conv.id;

  -- 5. tell the team (new lead, or a lead that turned hot)
  if first_lead or (score = 'hot' and coalesce(conv.lead_score, '') <> 'hot') then
    insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
    select conv.organization_id, m.user_id, 'lead', 'inbox.leadNotification',
           jsonb_build_object('name', left(coalesce(nm, conv.title, ''), 80), 'score', score, 'channel', conv.channel, 'need', left(coalesce(need, ''), 80)),
           '/inbox?c=' || conv.id
      from public.organization_members m
     where m.organization_id = conv.organization_id
       and (m.user_id = conv.assignee_id
            or (conv.assignee_id is null and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'sales')));
  end if;

  perform public.emit_event(conv.organization_id, 'contact.updated', 'contact', cid,
    jsonb_build_object('source', 'ai_agent', 'conversation_id', conv.id, 'score', score, 'deal_id', did));
  return jsonb_build_object('ok', true, 'contact_id', cid, 'deal_id', did, 'first', first_lead, 'score', score);
end;
$$;

-- ------------------------------------------------------------ follow-ups
-- Conversations where the AI answered last and the customer went quiet for the
-- agent's follow-up delay (one follow-up per conversation, max 2 per day overall per conversation).
create or replace function public.ai_followup_candidates(p_limit int default 20)
returns table (conversation_id uuid, organization_id uuid, agent_id uuid, channel text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.organization_id, a.id, c.channel
    from public.conversations c
    join lateral (
      select id, followup_hours from public.ai_agents
       where organization_id = c.organization_id and enabled and c.channel = any (autopilot_channels)
       order by created_at limit 1
    ) a on true
   where c.ai_mode = 'auto'
     and c.status = 'open'
     and c.channel <> 'web'
     and c.followup_count < 1
     and a.followup_hours > 0
     and c.last_message_at < now() - make_interval(hours => a.followup_hours)
     and c.last_message_at > now() - interval '7 days'
     and exists (
       select 1 from public.messages m
        where m.conversation_id = c.id
          and m.id = (select m2.id from public.messages m2 where m2.conversation_id = c.id order by m2.created_at desc limit 1)
          and m.direction = 'out' and m.ai_agent_id is not null
     )
     -- WhatsApp official: only inside Meta's 24-hour customer-service window
     and (c.channel <> 'whatsapp' or exists (
       select 1 from public.messages mi where mi.conversation_id = c.id and mi.direction = 'in' and mi.created_at > now() - interval '23 hours'))
   order by c.last_message_at
   limit greatest(1, least(p_limit, 100));
$$;

-- ------------------------------------------------------------ privileges
do $$
declare f text;
begin
  foreach f in array array['public.ai_capture_lead(uuid, jsonb)', 'public.ai_followup_candidates(int)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
