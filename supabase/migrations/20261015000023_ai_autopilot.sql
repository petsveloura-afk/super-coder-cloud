-- ============================================================================
-- SUPER CODER CLOUD — 0023 AI autopilot: the business's AI agent answers
-- customers on every channel and hands off to a human when needed.
--   • new channels: website chat (web), WhatsApp by QR (whatsapp_qr), e-mail
--   • conversations.ai_mode auto|human (a human reply or a handoff stops the AI)
--   • agents: autopilot channels, greeting, handoff rules
--   • server-side (service role) metering of AI credits for automatic replies
--   • ingest RPCs for e-mail / QR WhatsApp / website chat
-- Additive only: existing objects keep working unchanged.
-- ============================================================================

-- ------------------------------------------------------------ channel kinds
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.channel_accounts'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.channel_accounts drop constraint %I', c.conname);
  end loop;
  for c in
    select conname from pg_constraint
     where conrelid = 'public.conversations'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%channel %'
  loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.channel_accounts
  add constraint channel_accounts_kind_check
  check (kind in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email'));
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'web'));

-- ------------------------------------------------------------ conversations
alter table public.conversations add column if not exists ai_mode text not null default 'auto';
do $$ begin
  alter table public.conversations add constraint conversations_ai_mode_check check (ai_mode in ('auto', 'human'));
exception when duplicate_object then null; end $$;
alter table public.conversations add column if not exists handoff_at timestamptz;
alter table public.conversations add column if not exists subject text;
do $$ begin
  alter table public.conversations add constraint conversations_subject_len check (subject is null or char_length(subject) <= 300);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ messages
alter table public.messages add column if not exists ai_agent_id uuid;
alter table public.messages add column if not exists meta jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.messages
    add constraint messages_ai_agent_fk foreign key (organization_id, ai_agent_id)
    references public.ai_agents (organization_id, id) on delete set null (ai_agent_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.messages add constraint messages_meta_object check (jsonb_typeof(meta) = 'object');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ agents
alter table public.ai_agents add column if not exists autopilot_channels text[] not null default '{}'::text[];
do $$ begin
  alter table public.ai_agents add constraint ai_agents_autopilot_channels_check
    check (autopilot_channels <@ array['web', 'telegram', 'whatsapp', 'whatsapp_qr', 'sms', 'email']::text[]);
exception when duplicate_object then null; end $$;
alter table public.ai_agents add column if not exists greeting text not null default '';
alter table public.ai_agents add column if not exists handoff_rules text not null default '';
do $$ begin
  alter table public.ai_agents add constraint ai_agents_greeting_len check (char_length(greeting) <= 500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_agents add constraint ai_agents_handoff_rules_len check (char_length(handoff_rules) <= 2000);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ metered feature
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.ai_usage'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%feature%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('contact_summary', 'followup_draft', 'agent_chat', 'site_builder', 'image_gen', 'autopilot'));

-- ------------------------------------------------- server-side credit metering
-- Automatic replies run without a signed-in user (webhooks, cron). The server
-- (service role) reserves and finalizes credits with the same plan limits.
create or replace function public.reserve_ai_credits_system(p_org uuid, p_feature text, p_agent uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  usage_id bigint;
  demo boolean;
begin
  select is_demo into demo from public.organizations where id = p_org;
  if demo is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if demo then
    raise exception 'demo_mode' using errcode = 'P0001';
  end if;
  if not public.public_rate_limit('ai-sys:' || p_org::text, 60, 60) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  lim := public.plan_limit(p_org, 'ai_credits_monthly');
  if lim is not null and public.ai_credits_used(p_org) + 1 > lim then
    raise exception 'plan_limit:ai_credits' using errcode = 'P0001', hint = 'upgrade';
  end if;
  insert into public.ai_usage (organization_id, user_id, agent_id, feature, credits, status)
  values (p_org, null, p_agent, p_feature, 1, 'pending')
  returning id into usage_id;
  return usage_id;
end;
$$;

create or replace function public.finalize_ai_usage_system(
  p_usage_id bigint, p_provider text, p_model text, p_input int, p_output int, p_ok boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ai_usage
     set provider = left(p_provider, 40),
         model = left(p_model, 80),
         input_tokens = greatest(p_input, 0),
         output_tokens = greatest(p_output, 0),
         credits = case when p_ok then greatest(1, ceil((greatest(p_input, 0) + greatest(p_output, 0)) / 1000.0)::int) else 0 end,
         status = case when p_ok then 'ok' else 'error' end
   where id = p_usage_id and user_id is null and status = 'pending';
end;
$$;

-- ------------------------------------------------- inbound: e-mail / QR WhatsApp
-- Same flow as ingest_channel_message (0017) plus e-mail matching, subject and
-- metadata (e-mail threading). Called by the server after verifying the source.
create or replace function public.ingest_channel_message_v2(
  p_token text,
  p_kind text,
  p_external_chat text,
  p_sender_name text,
  p_phone text,
  p_email text,
  p_text text,
  p_external_message text,
  p_media jsonb default null,
  p_subject text default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  acc public.channel_accounts;
  conv public.conversations;
  cid uuid;
  ph text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  mid uuid;
  nm text;
begin
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = p_kind;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if acc.status = 'disabled' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if ph is not null and left(ph, 1) <> '+' then ph := '+' || ph; end if;
  if ph is not null and ph !~ '^\+?[0-9]{7,15}$' then ph := null; end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em := null; end if;

  select * into conv from public.conversations
   where organization_id = acc.organization_id and channel = p_kind and external_id = left(p_external_chat, 120);

  if conv.id is null then
    if em is not null then
      select id into cid from public.contacts where organization_id = acc.organization_id and email = em::citext order by created_at limit 1;
    end if;
    if cid is null and ph is not null then
      select id into cid from public.contacts
       where organization_id = acc.organization_id
         and (phone = ph or phone = regexp_replace(ph, '^\+972', '0') or '+' || phone = ph)
       order by created_at limit 1;
    end if;
    if cid is null then
      nm := left(coalesce(nullif(btrim(p_sender_name), ''), split_part(coalesce(em, ''), '@', 1), ph, p_external_chat), 80);
      begin
        insert into public.contacts (organization_id, first_name, last_name, email, phone, source)
        values (acc.organization_id,
                left(split_part(nm, ' ', 1), 80),
                left(coalesce(nullif(btrim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), ''), ''), 80),
                em, ph, left(p_kind, 40))
        returning id into cid;
      exception when others then
        cid := null; -- plan limit etc.: keep the conversation anyway
      end;
    end if;
    insert into public.conversations (organization_id, channel, external_id, contact_id, title, subject)
    values (acc.organization_id, p_kind, left(p_external_chat, 120), cid,
            left(coalesce(nullif(btrim(p_sender_name), ''), em, ph, p_external_chat), 160),
            nullif(left(coalesce(p_subject, ''), 300), ''))
    on conflict (organization_id, channel, external_id) do update set title = excluded.title
    returning * into conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status, meta)
  values (acc.organization_id, conv.id, 'in', left(coalesce(p_text, ''), 8000), p_media, left(p_external_message, 200), 'received',
          case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end
            || case when p_subject is not null then jsonb_build_object('subject', left(p_subject, 300)) else '{}'::jsonb end)
  on conflict do nothing
  returning id into mid;
  if mid is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.conversations
     set unread_count = unread_count + 1, last_message_at = now(), status = 'open',
         subject = coalesce(nullif(left(coalesce(p_subject, ''), 300), ''), subject),
         last_message_preview = left(coalesce(nullif(p_text, ''), nullif(p_subject, ''), '📎'), 200)
   where id = conv.id;
  update public.channel_accounts set last_inbound_at = now(), status = case when status = 'error' then 'active' else status end where id = acc.id;

  perform public.emit_event(acc.organization_id, 'message.received', 'contact', conv.contact_id,
    jsonb_build_object('channel', p_kind, 'conversation_id', conv.id, 'contact_id', conv.contact_id, 'text', left(coalesce(p_text, ''), 1000)));
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'contact_id', conv.contact_id,
                            'organization_id', acc.organization_id, 'ai_mode', conv.ai_mode);
end;
$$;

-- ------------------------------------------------- inbound: website chat
-- Visitors of the business's websites (or its embedded chat) talk to the AI
-- agent. The conversation is keyed by a random visitor token kept in the
-- visitor's browser. A contact is created/linked once a phone or e-mail is known.
create or replace function public.ingest_web_message(
  p_org_slug text,
  p_visitor text,
  p_name text,
  p_email text,
  p_phone text,
  p_text text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  org_id uuid;
  conv public.conversations;
  cid uuid;
  mid uuid;
  nm text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
begin
  if p_visitor !~ '^[a-f0-9]{32,64}$' then
    raise exception 'invalid_visitor' using errcode = '22023';
  end if;
  select id into org_id from public.organizations where slug = p_org_slug;
  if org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into conv from public.conversations where organization_id = org_id and channel = 'web' and external_id = 'v:' || p_visitor;
  if conv.id is null then
    insert into public.conversations (organization_id, channel, external_id, title)
    values (org_id, 'web', 'v:' || p_visitor, coalesce(nm, 'Website visitor'))
    on conflict (organization_id, channel, external_id) do update set title = public.conversations.title
    returning * into conv;
  end if;

  if (nullif(btrim(coalesce(p_email, '')), '') is not null or nullif(btrim(coalesce(p_phone, '')), '') is not null) then
    begin
      cid := public.upsert_public_contact(org_id, coalesce(nm, conv.title), p_email, p_phone, 'website_chat', false, '{}'::jsonb);
    exception when others then
      cid := null;
    end;
    if cid is not null and conv.contact_id is null then
      update public.conversations set contact_id = cid where id = conv.id;
      conv.contact_id := cid;
    end if;
  end if;
  if nm is not null and conv.title = 'Website visitor' then
    update public.conversations set title = nm where id = conv.id;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, body, status, meta)
  values (org_id, conv.id, 'in', left(coalesce(p_text, ''), 4000), 'received',
          case when jsonb_typeof(p_meta) = 'object' then p_meta else '{}'::jsonb end)
  returning id into mid;
  update public.conversations
     set unread_count = unread_count + 1, last_message_at = now(), status = 'open',
         last_message_preview = left(coalesce(nullif(p_text, ''), '…'), 200)
   where id = conv.id;

  perform public.emit_event(org_id, 'message.received', 'contact', conv.contact_id,
    jsonb_build_object('channel', 'web', 'conversation_id', conv.id, 'contact_id', conv.contact_id, 'text', left(coalesce(p_text, ''), 1000)));
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'contact_id', conv.contact_id,
                            'organization_id', org_id, 'ai_mode', conv.ai_mode);
end;
$$;

-- Public (anon) config for the website chat bubble — no secrets.
create or replace function public.web_chat_config(p_org_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'org', o.name,
           'enabled', a.id is not null,
           'agent', coalesce(a.name, ''),
           'greeting', coalesce(a.greeting, ''),
           'language', coalesce(a.language, 'he'))
    from public.organizations o
    left join lateral (
      select id, name, greeting, language from public.ai_agents
       where organization_id = o.id and enabled and 'web' = any (autopilot_channels)
       order by created_at limit 1
    ) a on true
   where o.slug = p_org_slug and not o.is_demo;
$$;

-- ------------------------------------------------- handoff to a human
create or replace function public.ai_handoff(p_conv uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
begin
  update public.conversations set ai_mode = 'human', handoff_at = now()
   where id = p_conv and ai_mode = 'auto'
   returning * into conv;
  if conv.id is null then return; end if;
  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  select conv.organization_id, m.user_id, 'inbox', 'inbox.handoffNotification',
         jsonb_build_object('name', left(coalesce(conv.title, ''), 80), 'channel', conv.channel, 'reason', left(coalesce(p_reason, ''), 120)),
         '/inbox?c=' || conv.id
    from public.organization_members m
   where m.organization_id = conv.organization_id
     and (m.user_id = conv.assignee_id
          or (conv.assignee_id is null and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'support', 'sales')));
end;
$$;

-- ------------------------------------------------- privileges
do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_ai_credits_system(uuid, text, uuid)',
    'public.finalize_ai_usage_system(bigint, text, text, int, int, boolean)',
    'public.ingest_channel_message_v2(text, text, text, text, text, text, text, text, jsonb, text, jsonb)',
    'public.ingest_web_message(text, text, text, text, text, text, jsonb)',
    'public.ai_handoff(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  execute 'revoke execute on function public.web_chat_config(text) from public';
  execute 'grant execute on function public.web_chat_config(text) to anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.web_chat_config(text) to service_role';
    execute 'grant select, insert, update, delete on public.conversations, public.messages, public.channel_accounts, public.ai_agents, public.ai_usage to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------- existing workspaces
-- The first enabled agent of every workspace starts answering customers
-- (website chat, Telegram, WhatsApp, e-mail). SMS stays opt-in (it costs per message).
update public.ai_agents a
   set autopilot_channels = array['web', 'telegram', 'whatsapp', 'whatsapp_qr', 'email']::text[]
 where a.id in (
         select distinct on (organization_id) id
           from public.ai_agents
          where enabled
          order by organization_id, created_at
       )
   and cardinality(a.autopilot_channels) = 0
   and not exists (select 1 from public.ai_agents b where b.organization_id = a.organization_id and cardinality(b.autopilot_channels) > 0);

notify pgrst, 'reload schema';
