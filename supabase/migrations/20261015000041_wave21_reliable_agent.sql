-- =============================================================================
-- Wave 21 — the agent never gets stuck after one answer.
--
--  * ingest_owner_message_v2: like ingest_owner_message (wave 12) but the caller decides whether
--    the message is a real owner take-over. An automatic message from the phone (a WhatsApp /
--    Telegram Business greeting or away message, an echo of the agent's own reply) is stored and
--    shown in the inbox, but the agent keeps the conversation.
--  * conversations.ai_note / ai_note_at: the last reason the agent stopped or did not answer —
--    shown in the inbox next to "back to the agent".
-- Additive: the wave-12 function stays as it was.
-- =============================================================================

alter table public.conversations add column if not exists ai_note text;
alter table public.conversations add column if not exists ai_note_at timestamptz;

do $$ begin
  alter table public.conversations add constraint conversations_ai_note_len check (ai_note is null or char_length(ai_note) <= 200);
exception when duplicate_object then null; end $$;

create or replace function public.ingest_owner_message_v2(
  p_token text, p_kind text, p_chat text, p_text text, p_message text,
  p_media jsonb default null, p_takeover boolean default true, p_auto text default null
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
  mid uuid;
  ph text;
  chat text := left(btrim(coalesce(p_chat, '')), 120);
  auto text := nullif(left(btrim(coalesce(p_auto, '')), 40), '');
begin
  if p_kind not in ('whatsapp_qr', 'telegram_user') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if chat !~ '^\d{3,20}$' then raise exception 'invalid_chat' using errcode = '22023'; end if;
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = p_kind;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if acc.status = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;

  select * into conv from public.conversations where organization_id = acc.organization_id and channel = p_kind and external_id = chat;
  if conv.id is null then
    if p_kind = 'whatsapp_qr' then
      ph := '+' || chat;
      select id into cid from public.contacts
       where organization_id = acc.organization_id and (phone = ph or phone = regexp_replace(ph, '^\+972', '0') or '+' || phone = ph)
       order by created_at limit 1;
    end if;
    insert into public.conversations (organization_id, channel, external_id, contact_id, title)
    values (acc.organization_id, p_kind, chat, cid, case when p_kind = 'whatsapp_qr' then '+' || chat else 'Telegram ' || chat end)
    on conflict (organization_id, channel, external_id) do update set title = public.conversations.title
    returning * into conv;
  end if;

  insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status, meta)
  values (acc.organization_id, conv.id, 'out', left(coalesce(p_text, ''), 8000), p_media, left(p_message, 200), 'sent',
          jsonb_build_object('owner', true, 'device', 'phone') || case when auto is null then '{}'::jsonb else jsonb_build_object('auto', auto) end)
  on conflict do nothing
  returning id into mid;
  if mid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if coalesce(p_takeover, true) then
    update public.conversations
       set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200),
           unread_count = 0, ai_mode = 'human', handoff_at = coalesce(handoff_at, now()),
           ai_note = 'owner_phone', ai_note_at = now()
     where id = conv.id;
  else
    -- an automatic message from the phone: shown in the chat, the agent keeps the conversation
    -- (the take-over clock set by the wave-12 trigger is cleared again)
    update public.conversations
       set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200),
           owner_takeover_at = case when ai_mode = 'auto' then null else owner_takeover_at end
     where id = conv.id;
  end if;
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'owner', true,
                            'takeover', coalesce(p_takeover, true), 'organization_id', acc.organization_id);
end;
$$;
revoke all on function public.ingest_owner_message_v2(text, text, text, text, text, jsonb, boolean, text) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ingest_owner_message_v2(text, text, text, text, text, jsonb, boolean, text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------- handoff keeps its reason for the inbox
-- Same as wave 9 (notifications to the team), plus the reason in conversations.ai_note.
create or replace function public.ai_handoff(p_conv uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
begin
  update public.conversations set ai_mode = 'human', handoff_at = now(),
         ai_note = left(coalesce(nullif(p_reason, ''), 'agent'), 200), ai_note_at = now()
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

notify pgrst, 'reload schema';
