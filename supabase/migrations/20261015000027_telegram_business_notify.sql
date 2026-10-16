-- ============================================================================
-- SUPER CODER CLOUD — 0027
--   A. Telegram Business: the bot connected as a chatbot to a personal
--      Telegram account (Settings → Telegram Business → Chatbots). Customers'
--      messages arrive as business_message and replies must carry the
--      business_connection_id. Messages the owner types himself are recorded
--      (and the agent steps back in that chat).
--   B. Team updates: invite people (e-mail, Telegram, WhatsApp, SMS) to get
--      the conversations the agent manages, new leads and handoffs.
-- Additive only.
-- ============================================================================

-- ------------------------------------------------------------ A. business
alter table public.conversations add column if not exists business_connection_id text
  check (business_connection_id is null or char_length(business_connection_id) <= 200);

create table if not exists public.telegram_business_connections (
  id text primary key check (char_length(id) between 1 and 200),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.channel_accounts (id) on delete cascade,
  owner_user_id bigint not null,
  owner_chat_id bigint,
  owner_name text check (owner_name is null or char_length(owner_name) <= 160),
  owner_username text check (owner_username is null or char_length(owner_username) <= 64),
  can_reply boolean not null default false,
  is_enabled boolean not null default true,
  rights jsonb not null default '{}'::jsonb check (jsonb_typeof(rights) = 'object'),
  messages_in int not null default 0,
  messages_out int not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_business_connections_org_idx on public.telegram_business_connections (organization_id, updated_at desc);
alter table public.telegram_business_connections enable row level security;
drop policy if exists telegram_business_connections_select on public.telegram_business_connections;
create policy telegram_business_connections_select on public.telegram_business_connections for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.telegram_business_connections from authenticated, anon;
grant select on public.telegram_business_connections to authenticated;

-- connection created / edited / disabled (update.business_connection)
create or replace function public.upsert_telegram_business_connection(
  p_token text, p_id text, p_owner_id bigint, p_owner_chat bigint, p_owner_name text, p_owner_username text,
  p_can_reply boolean, p_enabled boolean, p_rights jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acc public.channel_accounts;
  was_new boolean;
begin
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = 'telegram';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  was_new := not exists (select 1 from public.telegram_business_connections where id = p_id);
  insert into public.telegram_business_connections (id, organization_id, account_id, owner_user_id, owner_chat_id, owner_name, owner_username, can_reply, is_enabled, rights, updated_at)
  values (left(p_id, 200), acc.organization_id, acc.id, p_owner_id, p_owner_chat, left(p_owner_name, 160), left(p_owner_username, 64),
          coalesce(p_can_reply, false), coalesce(p_enabled, true), case when jsonb_typeof(p_rights) = 'object' then p_rights else '{}'::jsonb end, now())
  on conflict (id) do update
    set owner_chat_id = excluded.owner_chat_id, owner_name = excluded.owner_name, owner_username = excluded.owner_username,
        can_reply = excluded.can_reply, is_enabled = excluded.is_enabled, rights = excluded.rights, updated_at = now();
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (acc.organization_id, null, case when not coalesce(p_enabled, true) then 'telegram.business.disconnected' when was_new then 'telegram.business.connected' else 'telegram.business.updated' end,
          'channel_account', acc.id, jsonb_build_object('connection', left(p_id, 200), 'owner', left(coalesce(p_owner_username, p_owner_name, ''), 64), 'can_reply', coalesce(p_can_reply, false)));
  return jsonb_build_object('ok', true, 'organization_id', acc.organization_id, 'new', was_new);
end;
$$;

-- a business chat message: from a customer (in) or typed by the account owner (out)
create or replace function public.ingest_telegram_business(
  p_token text, p_connection text, p_chat bigint, p_sender_name text, p_text text, p_message text,
  p_media jsonb default null, p_from_owner boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  acc public.channel_accounts;
  bc public.telegram_business_connections;
  conv public.conversations;
  cid uuid;
  mid uuid;
  ext text := 'biz:' || p_chat::text;
  nm text;
begin
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = 'telegram';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if acc.status = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  select * into bc from public.telegram_business_connections where id = p_connection and organization_id = acc.organization_id;

  select * into conv from public.conversations where organization_id = acc.organization_id and channel = 'telegram' and external_id = ext;
  if conv.id is null then
    -- same person as in the bot chat → same contact (telegram_id)
    select id into cid from public.contacts where organization_id = acc.organization_id and custom_fields ->> 'telegram_id' = p_chat::text limit 1;
    if cid is null and not p_from_owner then
      nm := left(coalesce(nullif(btrim(p_sender_name), ''), 'Telegram ' || p_chat::text), 80);
      begin
        insert into public.contacts (organization_id, first_name, last_name, source, custom_fields)
        values (acc.organization_id, left(split_part(nm, ' ', 1), 80), left(coalesce(nullif(btrim(substr(nm, length(split_part(nm, ' ', 1)) + 1)), ''), ''), 80),
                'telegram', jsonb_build_object('telegram_id', p_chat::text, 'telegram_business', true))
        returning id into cid;
      exception when others then cid := null;
      end;
    end if;
    insert into public.conversations (organization_id, channel, external_id, contact_id, title, business_connection_id)
    values (acc.organization_id, 'telegram', ext, cid, left(coalesce(nullif(btrim(case when p_from_owner then null else p_sender_name end), ''), 'Telegram ' || p_chat::text), 160), left(p_connection, 200))
    on conflict (organization_id, channel, external_id) do update set business_connection_id = excluded.business_connection_id
    returning * into conv;
  elsif conv.business_connection_id is distinct from p_connection then
    update public.conversations set business_connection_id = left(p_connection, 200) where id = conv.id returning * into conv;
  end if;

  if p_from_owner then
    -- the owner answered himself: keep it in the conversation and let the person lead this chat
    insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status, meta)
    values (acc.organization_id, conv.id, 'out', left(coalesce(p_text, ''), 8000), p_media, left(p_message, 200), 'sent',
            jsonb_build_object('business', true, 'owner', true))
    on conflict do nothing
    returning id into mid;
    if mid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
    update public.conversations
       set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200),
           ai_mode = 'human', handoff_at = coalesce(handoff_at, now())
     where id = conv.id;
    update public.telegram_business_connections set messages_out = messages_out + 1, last_message_at = now() where id = p_connection;
    return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'owner', true, 'organization_id', acc.organization_id);
  end if;

  insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status, meta)
  values (acc.organization_id, conv.id, 'in', left(coalesce(p_text, ''), 8000), p_media, left(p_message, 200), 'received',
          jsonb_build_object('business', true))
  on conflict do nothing
  returning id into mid;
  if mid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  update public.conversations
     set unread_count = unread_count + 1, last_message_at = now(), status = 'open',
         last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200)
   where id = conv.id;
  update public.channel_accounts set last_inbound_at = now(), status = case when status = 'error' then 'active' else status end where id = acc.id;
  update public.telegram_business_connections set messages_in = messages_in + 1, last_message_at = now() where id = p_connection;
  perform public.emit_event(acc.organization_id, 'message.received', 'contact', conv.contact_id,
    jsonb_build_object('channel', 'telegram', 'business', true, 'conversation_id', conv.id, 'contact_id', conv.contact_id, 'text', left(coalesce(p_text, ''), 1000)));
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'contact_id', conv.contact_id,
                            'organization_id', acc.organization_id, 'ai_mode', conv.ai_mode,
                            'can_reply', coalesce(bc.can_reply, true) and coalesce(bc.is_enabled, true));
end;
$$;

-- follow-ups: business chats only inside Telegram's 24-hour reply window
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
     -- WhatsApp official / Telegram Business: only inside the 24-hour window
     and ((c.channel <> 'whatsapp' and c.business_connection_id is null) or exists (
       select 1 from public.messages mi where mi.conversation_id = c.id and mi.direction = 'in' and mi.created_at > now() - interval '23 hours'))
   order by c.last_message_at
   limit greatest(1, least(p_limit, 100));
$$;

-- ------------------------------------------------------------ B. team updates
create table if not exists public.notify_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('email', 'telegram', 'whatsapp', 'sms')),
  -- e-mail / phone; for telegram the chat id once the invite was accepted
  target text check (target is null or char_length(target) between 3 and 200),
  label text check (label is null or char_length(label) <= 80),
  events text[] not null default array['leads', 'handoff']::text[]
    check (events <@ array['messages', 'leads', 'handoff', 'daily']::text[]),
  enabled boolean not null default true,
  invite_code text unique check (invite_code is null or invite_code ~ '^[A-Za-z0-9]{8,32}$'),
  verified_at timestamptz,
  last_sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  sent_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind = 'telegram' or target is not null)
);
create index if not exists notify_recipients_org_idx on public.notify_recipients (organization_id, enabled);
alter table public.notify_recipients enable row level security;
drop policy if exists notify_recipients_select on public.notify_recipients;
create policy notify_recipients_select on public.notify_recipients for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage'));
drop policy if exists notify_recipients_insert on public.notify_recipients;
create policy notify_recipients_insert on public.notify_recipients for insert to authenticated
  with check (public.has_permission(organization_id, 'integrations.manage'));
drop policy if exists notify_recipients_update on public.notify_recipients;
create policy notify_recipients_update on public.notify_recipients for update to authenticated
  using (public.has_permission(organization_id, 'integrations.manage'))
  with check (public.has_permission(organization_id, 'integrations.manage'));
drop policy if exists notify_recipients_delete on public.notify_recipients;
create policy notify_recipients_delete on public.notify_recipients for delete to authenticated
  using (public.has_permission(organization_id, 'integrations.manage'));
grant select, insert, update, delete on public.notify_recipients to authenticated;

-- at most 20 recipients per workspace
create or replace function public.notify_recipients_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.notify_recipients where organization_id = new.organization_id) >= 20 then
    raise exception 'plan_limit:notify_recipients' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists notify_recipients_limit on public.notify_recipients;
create trigger notify_recipients_limit before insert on public.notify_recipients for each row execute function public.notify_recipients_limit();

-- the invited person pressed Start in the business's bot with the invite code
create or replace function public.link_notify_recipient(p_token text, p_code text, p_chat text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acc public.channel_accounts;
  r public.notify_recipients;
  org_name text;
begin
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = 'telegram';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.notify_recipients
     set target = left(p_chat, 200), verified_at = now(), enabled = true,
         label = coalesce(label, nullif(left(btrim(coalesce(p_name, '')), 80), ''))
   where invite_code = p_code and organization_id = acc.organization_id and kind = 'telegram'
  returning * into r;
  if r.id is null then return jsonb_build_object('ok', false); end if;
  select name into org_name from public.organizations where id = acc.organization_id;
  return jsonb_build_object('ok', true, 'recipient_id', r.id, 'org_name', org_name, 'events', r.events);
end;
$$;

-- the person wants no more updates (/stop_updates in the bot)
create or replace function public.unlink_notify_recipient(p_token text, p_chat text)
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with acc as (select organization_id from public.channel_accounts where webhook_token = p_token and kind = 'telegram'),
  u as (update public.notify_recipients n set enabled = false
          from acc where n.organization_id = acc.organization_id and n.kind = 'telegram' and n.target = p_chat returning 1)
  select count(*)::int from u;
$$;

-- delivery counter (service)
create or replace function public.notify_recipient_sent(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notify_recipients set sent_count = sent_count + 1 where id = p_id;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.upsert_telegram_business_connection(text, text, bigint, bigint, text, text, boolean, boolean, jsonb)',
    'public.ingest_telegram_business(text, text, bigint, text, text, text, jsonb, boolean)',
    'public.ai_followup_candidates(int)',
    'public.link_notify_recipient(text, text, text, text)',
    'public.unlink_notify_recipient(text, text)',
    'public.notify_recipient_sent(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.telegram_business_connections, public.notify_recipients to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
