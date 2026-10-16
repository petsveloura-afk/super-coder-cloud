-- ============================================================================
-- SUPER CODER CLOUD — 0017 Messaging: channel accounts (WhatsApp Cloud API,
-- Telegram bot, SMS via Twilio), conversations and messages (omnichannel inbox).
-- Secrets are encrypted by the app (AES-256-GCM, ENCRYPTION_KEY) and the
-- ciphertext column is not readable by signed-in users at all (column grant).
-- ============================================================================

create table if not exists public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('whatsapp', 'telegram', 'sms')),
  name text not null default '' check (char_length(name) <= 120),
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb,          -- non-secret: bot username, phone_number_id, from number…
  secret_enc text,                                    -- AES-GCM ciphertext (tokens); never exposed to clients
  webhook_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  last_error text,
  last_inbound_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind),
  unique (organization_id, id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'telegram', 'sms')),
  external_id text not null check (char_length(external_id) <= 120),  -- chat id / phone
  contact_id uuid,
  title text check (title is null or char_length(title) <= 160),
  status text not null default 'open' check (status in ('open', 'closed')),
  assignee_id uuid references auth.users (id) on delete set null,
  unread_count int not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text check (last_message_preview is null or char_length(last_message_preview) <= 200),
  created_at timestamptz not null default now(),
  unique (organization_id, channel, external_id),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists conversations_org_last_idx on public.conversations (organization_id, last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  body text not null default '' check (char_length(body) <= 8000),
  media jsonb,
  external_id text check (external_id is null or char_length(external_id) <= 200),
  status text not null default 'received' check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error text,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);
create unique index if not exists messages_external_once on public.messages (conversation_id, external_id) where external_id is not null;

-- --------------------------------------------------------------- RLS ----
alter table public.channel_accounts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy channel_accounts_select on public.channel_accounts for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage') or public.has_permission(organization_id, 'inbox.read'));
create policy channel_accounts_insert on public.channel_accounts for insert to authenticated with check (public.has_permission(organization_id, 'integrations.manage'));
create policy channel_accounts_update on public.channel_accounts for update to authenticated
  using (public.has_permission(organization_id, 'integrations.manage')) with check (public.has_permission(organization_id, 'integrations.manage'));
create policy channel_accounts_delete on public.channel_accounts for delete to authenticated using (public.has_permission(organization_id, 'integrations.manage'));

create policy conversations_select on public.conversations for select to authenticated using (public.has_permission(organization_id, 'inbox.read'));
create policy conversations_update on public.conversations for update to authenticated
  using (public.has_permission(organization_id, 'inbox.reply')) with check (public.has_permission(organization_id, 'inbox.reply'));
create policy messages_select on public.messages for select to authenticated using (public.has_permission(organization_id, 'inbox.read'));

-- Column-level protection: the ciphertext is never selectable by signed-in users.
revoke select on public.channel_accounts from authenticated;
grant select (id, organization_id, kind, name, status, config, webhook_token, last_error, last_inbound_at, created_by, created_at, updated_at)
  on public.channel_accounts to authenticated;
grant insert, update, delete on public.channel_accounts to authenticated;
grant select, update on public.conversations to authenticated;
grant select on public.messages to authenticated;
revoke insert, delete on public.conversations from authenticated;
revoke insert, update, delete on public.messages from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.channel_accounts, public.conversations, public.messages to service_role;
  end if;
end $$;

-- ------------------------------------------------- inbound messages ----
-- Called by /api/channels/{kind}/{token} after the provider signature check.
create or replace function public.ingest_channel_message(
  p_token text,
  p_kind text,
  p_external_chat text,
  p_sender_name text,
  p_phone text,
  p_text text,
  p_external_message text,
  p_media jsonb default null
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
  mid uuid;
  first_name text;
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

  select * into conv from public.conversations
   where organization_id = acc.organization_id and channel = p_kind and external_id = left(p_external_chat, 120);

  if conv.id is null then
    -- match an existing contact by phone (WhatsApp/SMS) or Telegram id, else create one
    if ph is not null then
      select id into cid from public.contacts
       where organization_id = acc.organization_id
         and (phone = ph or phone = regexp_replace(ph, '^\+972', '0') or '+' || phone = ph)
       order by created_at limit 1;
    end if;
    if cid is null and p_kind = 'telegram' then
      select id into cid from public.contacts
       where organization_id = acc.organization_id and custom_fields ->> 'telegram_id' = p_external_chat limit 1;
    end if;
    if cid is null then
      first_name := left(coalesce(nullif(btrim(p_sender_name), ''), ph, 'Telegram ' || p_external_chat), 80);
      begin
        insert into public.contacts (organization_id, first_name, last_name, phone, source, custom_fields)
        values (acc.organization_id,
                split_part(first_name, ' ', 1),
                left(coalesce(nullif(btrim(substr(first_name, length(split_part(first_name, ' ', 1)) + 1)), ''), ''), 80),
                ph, p_kind,
                case when p_kind = 'telegram' then jsonb_build_object('telegram_id', p_external_chat) else '{}'::jsonb end)
        returning id into cid;
      exception when others then
        cid := null; -- plan limit etc.: still keep the conversation
      end;
    end if;
    insert into public.conversations (organization_id, channel, external_id, contact_id, title)
    values (acc.organization_id, p_kind, left(p_external_chat, 120), cid, left(coalesce(nullif(btrim(p_sender_name), ''), ph, p_external_chat), 160))
    on conflict (organization_id, channel, external_id) do update set title = excluded.title
    returning * into conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status)
  values (acc.organization_id, conv.id, 'in', left(coalesce(p_text, ''), 8000), p_media, left(p_external_message, 200), 'received')
  on conflict do nothing
  returning id into mid;
  if mid is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update public.conversations
     set unread_count = unread_count + 1, last_message_at = now(), status = 'open',
         last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200)
   where id = conv.id;
  update public.channel_accounts set last_inbound_at = now(), status = case when status = 'error' then 'active' else status end where id = acc.id;

  perform public.emit_event(acc.organization_id, 'message.received', 'contact', conv.contact_id,
    jsonb_build_object('channel', p_kind, 'conversation_id', conv.id, 'contact_id', conv.contact_id, 'text', left(coalesce(p_text, ''), 1000)));
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'contact_id', conv.contact_id);
end;
$$;
revoke execute on function public.ingest_channel_message(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ingest_channel_message(text, text, text, text, text, text, text, jsonb) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
