-- =============================================================================
-- Wave 12 — the owner answers himself from his phone (WhatsApp QR / Telegram
-- personal account), and the agent comes back after a quiet period.
--
--  * ingest_owner_message: a message the account owner typed on his own phone
--    (sent by the bridge as `owner_message`) is stored as an outgoing message
--    (meta.owner = true) and the conversation switches to the person
--    (ai_mode = 'human'), exactly like Telegram Business.
--  * conversations.owner_takeover_at — when the owner last wrote himself; set by
--    a trigger for every owner message (also Telegram Business).
--  * ai_owner_resume: when the agent's "resume after N minutes" is set and the
--    owner has been quiet for N minutes (and nobody from the team answered from
--    the app since), the agent manages the conversation again.
-- Additive only.
-- =============================================================================

alter table public.conversations add column if not exists owner_takeover_at timestamptz;

create or replace function public.tg_owner_takeover()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.direction = 'out' and coalesce(new.meta ->> 'owner', '') = 'true' then
    update public.conversations set owner_takeover_at = now() where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_owner_takeover on public.messages;
create trigger messages_owner_takeover after insert on public.messages
  for each row execute function public.tg_owner_takeover();

create or replace function public.ingest_owner_message(
  p_token text, p_kind text, p_chat text, p_text text, p_message text, p_media jsonb default null
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
begin
  if p_kind not in ('whatsapp_qr', 'telegram_user') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if chat !~ '^\d{3,20}$' then raise exception 'invalid_chat' using errcode = '22023'; end if;
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = p_kind;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if acc.status = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;

  select * into conv from public.conversations where organization_id = acc.organization_id and channel = p_kind and external_id = chat;
  if conv.id is null then
    -- the owner started a chat himself: link a known contact (by phone) when there is one
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
          jsonb_build_object('owner', true, 'device', 'phone'))
  on conflict do nothing
  returning id into mid;
  if mid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  update public.conversations
     set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200),
         unread_count = 0, ai_mode = 'human', handoff_at = coalesce(handoff_at, now())
   where id = conv.id;
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'owner', true, 'organization_id', acc.organization_id);
end;
$$;

revoke all on function public.ingest_owner_message(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_owner_message(text, text, text, text, text, jsonb) to service_role;

-- the agent takes the conversation back after the owner has been quiet for p_minutes
create or replace function public.ai_owner_resume(p_conversation uuid, p_minutes int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
begin
  if p_minutes is null or p_minutes <= 0 then return false; end if;
  select * into conv from public.conversations where id = p_conversation for update;
  if not found or conv.ai_mode <> 'human' or conv.owner_takeover_at is null then return false; end if;
  if conv.owner_takeover_at > now() - make_interval(mins => least(p_minutes, 10080)) then return false; end if;
  -- somebody from the team answered from the app after the owner → the person still leads
  if exists (select 1 from public.messages m where m.conversation_id = conv.id and m.direction = 'out'
              and m.sent_by is not null and m.created_at > conv.owner_takeover_at) then
    return false;
  end if;
  update public.conversations set ai_mode = 'auto', owner_takeover_at = null where id = conv.id;
  perform public.emit_event(conv.organization_id, 'ai.resumed', 'conversation', conv.id,
    jsonb_build_object('conversation_id', conv.id, 'after_minutes', p_minutes));
  return true;
end;
$$;

revoke all on function public.ai_owner_resume(uuid, int) from public, anon, authenticated;
grant execute on function public.ai_owner_resume(uuid, int) to service_role;
