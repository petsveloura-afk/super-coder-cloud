-- Platform upgrade (wave 19) — Instagram + Facebook Messenger as full channels, social comments,
-- scheduled social posts. ADDITIVE: constraints are widened (never narrowed), new tables, and
-- outbound_guard learns that Meta's 24-hour window applies to Messenger / Instagram as well.

-- ------------------------------------------------- channel kinds
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.channel_accounts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' and pg_get_constraintdef(oid) ilike '%whatsapp%' loop
    execute format('alter table public.channel_accounts drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%channel%' and pg_get_constraintdef(oid) ilike '%whatsapp%' loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.ai_agents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%autopilot_channels%' loop
    execute format('alter table public.ai_agents drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid = 'public.contact_identities'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' loop
    execute format('alter table public.contact_identities drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.channel_accounts add constraint channel_accounts_kind_check
  check (kind in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'telegram_user', 'messenger', 'instagram'));
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'web', 'telegram_user', 'voice', 'messenger', 'instagram'));
alter table public.ai_agents add constraint ai_agents_autopilot_channels_check
  check (autopilot_channels <@ array['web', 'telegram', 'whatsapp', 'whatsapp_qr', 'sms', 'email', 'telegram_user', 'messenger', 'instagram']::text[]);
alter table public.contact_identities add constraint contact_identities_kind_check
  check (kind in ('phone', 'email', 'telegram', 'web', 'other', 'messenger', 'instagram'));

-- agents that already answer the messaging apps also answer Messenger / Instagram (the business can switch them off)
update public.ai_agents set autopilot_channels = autopilot_channels || array['messenger', 'instagram']
 where ('whatsapp' = any (autopilot_channels) or 'telegram' = any (autopilot_channels))
   and not ('messenger' = any (autopilot_channels));

-- ------------------------------------------------- social comments (Facebook page + Instagram)
create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  post_id text check (post_id is null or char_length(post_id) <= 120),
  comment_id text not null check (char_length(comment_id) <= 120),
  parent_id text check (parent_id is null or char_length(parent_id) <= 120),
  author_id text check (author_id is null or char_length(author_id) <= 120),
  author_name text check (author_name is null or char_length(author_name) <= 160),
  body text not null default '' check (char_length(body) <= 8000),
  sentiment text check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'question', 'lead', 'spam')),
  ai_draft text check (ai_draft is null or char_length(ai_draft) <= 2000),
  reply_text text check (reply_text is null or char_length(reply_text) <= 2000),
  replied_by uuid references auth.users (id) on delete set null,
  replied_at timestamptz,
  status text not null default 'new' check (status in ('new', 'replied', 'auto_replied', 'hidden', 'ignored', 'dm_sent')),
  contact_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, platform, comment_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists social_comments_org_new on public.social_comments (organization_id, status, created_at desc);
alter table public.social_comments enable row level security;
drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read on public.social_comments for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
drop policy if exists social_comments_update on public.social_comments;
create policy social_comments_update on public.social_comments for update to authenticated
  using (public.has_permission(organization_id, 'inbox.reply')) with check (public.has_permission(organization_id, 'inbox.reply'));
revoke insert, delete on public.social_comments from anon, authenticated;
grant select, update on public.social_comments to authenticated;

-- ------------------------------------------------- scheduled social posts (the marketing agent)
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platforms text[] not null default array['facebook']::text[] check (platforms <@ array['facebook', 'instagram']::text[] and cardinality(platforms) between 1 and 2),
  body text not null check (char_length(body) between 1 and 5000),
  image_url text check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 1000)),
  scheduled_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'canceled')),
  results jsonb not null default '{}'::jsonb check (jsonb_typeof(results) = 'object'),
  source text not null default 'manual' check (source in ('manual', 'agent')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_due on public.social_posts (status, scheduled_at);
alter table public.social_posts enable row level security;
drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage') or public.has_permission(organization_id, 'analytics.read'));
drop policy if exists social_posts_write on public.social_posts;
create policy social_posts_write on public.social_posts for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage')) with check (public.has_permission(organization_id, 'campaigns.manage'));
grant select, insert, update, delete on public.social_posts to authenticated;

-- due posts, claimed atomically (cron)
create or replace function public.claim_due_social_posts(p_limit int default 10)
returns setof public.social_posts
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.social_posts p set status = 'publishing', updated_at = now()
   where p.id in (select id from public.social_posts where status = 'scheduled' and scheduled_at <= now()
                   order by scheduled_at limit greatest(1, least(p_limit, 50)) for update skip locked)
  returning p.*;
$$;
revoke all on function public.claim_due_social_posts(int) from public, anon, authenticated;

-- ------------------------------------------------- automation triggers for social events
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.automations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%trigger_type%' loop
    execute format('alter table public.automations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.automations add constraint automations_trigger_type_check check (trigger_type in (
  'contact.created', 'contact.status_changed', 'contact.tagged',
  'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'task.completed', 'webhook.inbound',
  'form.submitted', 'message.received', 'appointment.booked', 'ticket.created', 'invoice.paid',
  'site.behavior', 'quote.viewed', 'contract.signed', 'lead.hot', 'customer.opted_out',
  -- wave 19
  'social.comment', 'order.created', 'cart.abandoned', 'review.received', 'invoice.overdue', 'deal.stuck'));

-- ------------------------------------------------- the guard: Meta's 24-hour window also for Messenger / Instagram
-- (same function as wave 15; the only change is the channel list of rule 6)
create or replace function public.outbound_guard(p_conversation uuid, p_kind text, p_schedule uuid default null, p_log boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  ct public.contacts;
  pol jsonb;
  sch public.conversation_schedules;
  last_cust timestamptz;
  last_human timestamptz;
  last_auto timestamptz;
  n int;
  lt time;
  qs time;
  qe time;
  tz text;
  reason text := null;
  marketing boolean := p_kind in ('campaign', 'sequence');
  automated boolean := p_kind <> 'human';
begin
  select * into conv from public.conversations where id = p_conversation;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  if conv.contact_id is not null then select * into ct from public.contacts where id = conv.contact_id; end if;
  pol := public.conversation_policy(conv.organization_id);
  if p_schedule is not null then select * into sch from public.conversation_schedules where id = p_schedule; end if;

  -- the customer's state across ALL his channels
  select max(c.last_customer_at), max(c.last_human_at), max(c.last_auto_at) into last_cust, last_human, last_auto
    from public.conversations c
   where c.organization_id = conv.organization_id
     and (c.id = conv.id or (conv.contact_id is not null and c.contact_id = conv.contact_id));

  if p_kind = 'human' then
    reason := null;
  -- 1. consent
  elsif (conv.opt_out or ct.opted_out_at is not null) and p_kind <> 'reminder'
        and not (p_kind = 'ai_reply' and last_cust is not null and last_cust > coalesce(ct.opted_out_at, '-infinity'::timestamptz)
                 and not public.is_opt_out_text((select m.body from public.messages m where m.conversation_id = conv.id and m.direction = 'in' order by m.created_at desc limit 1))) then
    reason := 'opted_out';
  elsif marketing and not coalesce(ct.marketing_consent, false) then
    reason := 'no_consent';
  -- 2. ownership
  elsif p_kind in ('ai_reply', 'followup', 'automation') and conv.ai_mode = 'human' then
    reason := 'human_owns';
  -- 3. a person already answered after the customer's last message (any channel)
  elsif p_kind in ('ai_reply', 'followup', 'sequence') and last_human is not null and (last_cust is null or last_human >= last_cust) then
    reason := 'human_answered';
  -- 4. the customer replied after this item was planned
  elsif p_schedule is not null and sch.cancel_on_reply and last_cust is not null and last_cust > sch.created_at then
    reason := 'customer_replied';
  elsif p_schedule is not null and sch.status not in ('pending', 'processing') then
    reason := 'already_' || sch.status;
  end if;

  -- 5. attempts / gaps / caps (automated only)
  if reason is null and p_kind in ('followup', 'sequence') then
    select count(*) into n from public.messages m
     where m.conversation_id in (select c.id from public.conversations c where c.organization_id = conv.organization_id
                                  and (c.id = conv.id or (conv.contact_id is not null and c.contact_id = conv.contact_id)))
       and m.direction = 'out' and coalesce(m.meta ->> 'followup', '') = 'true'
       and m.created_at > coalesce(last_cust, '-infinity'::timestamptz);
    if p_kind = 'followup' and n >= greatest(1, least(coalesce((pol ->> 'followup_max')::int, 1), 5)) then
      reason := 'max_attempts';
    end if;
    if reason is null and last_cust is null and p_kind = 'followup' then
      reason := 'never_wrote';
    end if;
  end if;
  if reason is null and automated and p_kind not in ('ai_reply', 'reminder') and last_auto is not null
     and last_auto > now() - make_interval(mins => greatest(0, least(coalesce((pol ->> 'min_gap_minutes')::int, 2), 1440))) then
    reason := 'too_soon';
  end if;
  if reason is null and automated and p_kind not in ('ai_reply', 'reminder') then
    select count(*) into n from public.messages m
     where m.conversation_id in (select c.id from public.conversations c where c.organization_id = conv.organization_id
                                  and (c.id = conv.id or (conv.contact_id is not null and c.contact_id = conv.contact_id)))
       and m.direction = 'out' and m.sent_by is null and coalesce(m.meta ->> 'owner', '') <> 'true'
       and m.created_at > now() - interval '24 hours';
    if n >= greatest(1, coalesce((pol ->> 'daily_cap')::int, 12)) then reason := 'daily_cap'; end if;
  end if;
  -- 6. 24-hour windows (official WhatsApp, Messenger, Instagram, Telegram Business) for messages the customer did not just ask for
  if reason is null and p_kind in ('followup', 'sequence', 'scheduled', 'automation')
     and (conv.channel in ('whatsapp', 'messenger', 'instagram') or conv.business_connection_id is not null)
     and (last_cust is null or (select max(m.created_at) from public.messages m where m.conversation_id = conv.id and m.direction = 'in') < now() - interval '23 hours') then
    reason := 'outside_24h';
  end if;
  -- 7. quiet hours (follow-ups and marketing wait for the morning)
  if reason is null and p_kind in ('followup', 'sequence', 'campaign') and pol ->> 'quiet_start' ~ '^\d{2}:\d{2}$' and pol ->> 'quiet_end' ~ '^\d{2}:\d{2}$' then
    select coalesce(timezone, 'Asia/Jerusalem') into tz from public.organizations where id = conv.organization_id;
    lt := (now() at time zone tz)::time;
    qs := (pol ->> 'quiet_start')::time;
    qe := (pol ->> 'quiet_end')::time;
    if (qs < qe and lt >= qs and lt < qe) or (qs > qe and (lt >= qs or lt < qe)) then reason := 'quiet_hours'; end if;
  end if;

  if p_log and reason is not null then
    insert into public.conversation_guard_log (organization_id, conversation_id, kind, allowed, reason)
    values (conv.organization_id, conv.id, left(p_kind, 30), false, reason);
  end if;
  return jsonb_build_object('allowed', reason is null, 'reason', coalesce(reason, 'ok'), 'opt_out', conv.opt_out or ct.opted_out_at is not null,
                            'ai_mode', conv.ai_mode, 'last_customer_at', last_cust, 'last_human_at', last_human, 'last_auto_at', last_auto);
end;
$$;

revoke all on function public.outbound_guard(uuid, text, uuid, boolean) from public, anon, authenticated;




-- ------------------------------------------------- AI features of the new agents (credits are metered per feature)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.ai_usage'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%feature%' loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in (
  'contact_summary', 'followup_draft', 'agent_chat', 'site_builder', 'image_gen', 'autopilot',
  'insights', 'copilot', 'segment', 'site_copy', 'vision', 'transcribe', 'voice', 'kb', 'forecast', 'ab_variant',
  -- wave 19
  'social', 'marketing', 'sales_manager', 'brief', 'collections', 'review_reply'));

-- ------------------------------------------------- social settings (one row per business)
create table if not exists public.social_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- comments: the agent drafts a reply to every comment; with auto_reply it publishes it
  comment_drafts boolean not null default true,
  comment_auto_reply boolean not null default false,
  -- "price?" / "details?" under a post → a private DM that opens a conversation
  comment_private_reply boolean not null default true,
  hide_spam boolean not null default true,
  -- the marketing agent: weekly content plan (drafts — nothing is published without approval unless auto_publish)
  content_plan boolean not null default false,
  auto_publish boolean not null default false,
  posts_per_week int not null default 3 check (posts_per_week between 1 and 14),
  brand_voice text check (brand_voice is null or char_length(brand_voice) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.social_settings enable row level security;
drop policy if exists social_settings_read on public.social_settings;
create policy social_settings_read on public.social_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists social_settings_write on public.social_settings;
create policy social_settings_write on public.social_settings for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage') or public.has_permission(organization_id, 'campaigns.manage'))
  with check (public.has_permission(organization_id, 'settings.manage') or public.has_permission(organization_id, 'campaigns.manage'));
grant select, insert, update on public.social_settings to authenticated;

-- ------------------------------------------------- a new comment arrived (webhook) → stored once + automation event
create or replace function public.record_social_comment(
  p_org uuid, p_platform text, p_comment_id text, p_post_id text, p_parent_id text,
  p_author_id text, p_author_name text, p_body text, p_sentiment text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  cid uuid;
begin
  if p_platform not in ('facebook', 'instagram') then raise exception 'invalid_platform' using errcode = '22023'; end if;
  insert into public.social_comments (organization_id, platform, comment_id, post_id, parent_id, author_id, author_name, body, sentiment)
  values (p_org, p_platform, left(p_comment_id, 120), left(p_post_id, 120), left(p_parent_id, 120), left(p_author_id, 120), left(p_author_name, 160),
          left(coalesce(p_body, ''), 8000), case when p_sentiment in ('positive', 'neutral', 'negative', 'question', 'lead', 'spam') then p_sentiment end)
  on conflict (organization_id, platform, comment_id) do nothing
  returning id into cid;
  if cid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  perform public.emit_event(p_org, 'social.comment', 'social_comment', cid,
    jsonb_build_object('platform', p_platform, 'comment_id', p_comment_id, 'post_id', p_post_id, 'author', p_author_name,
                       'text', left(coalesce(p_body, ''), 1000), 'intent', p_sentiment));
  return jsonb_build_object('ok', true, 'id', cid);
end;
$fn$;
revoke all on function public.record_social_comment(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------- the owner answered from Meta (Business Suite / phone app)
-- Messenger / Instagram "echo" of a message the business typed itself → stored as the owner's
-- message and the agent steps back (same rule as WhatsApp QR / Telegram, wave 12).
create or replace function public.ingest_owner_message_meta(p_token text, p_kind text, p_chat text, p_text text, p_message text, p_media jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  acc public.channel_accounts;
  conv public.conversations;
  mid uuid;
  chat text := left(btrim(coalesce(p_chat, '')), 120);
begin
  if p_kind not in ('messenger', 'instagram') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if chat !~ '^\d{3,40}$' then raise exception 'invalid_chat' using errcode = '22023'; end if;
  select * into acc from public.channel_accounts where webhook_token = p_token and kind = p_kind;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if acc.status = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  select * into conv from public.conversations where organization_id = acc.organization_id and channel = p_kind and external_id = chat;
  if conv.id is null then
    insert into public.conversations (organization_id, channel, external_id, title)
    values (acc.organization_id, p_kind, chat, case when p_kind = 'instagram' then 'Instagram ' else 'Messenger ' end || right(chat, 6))
    on conflict (organization_id, channel, external_id) do update set title = public.conversations.title
    returning * into conv;
  end if;
  insert into public.messages (organization_id, conversation_id, direction, body, media, external_id, status, meta)
  values (acc.organization_id, conv.id, 'out', left(coalesce(p_text, ''), 8000), p_media, left(p_message, 200), 'sent',
          jsonb_build_object('owner', true, 'device', 'meta'))
  on conflict do nothing
  returning id into mid;
  if mid is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  update public.conversations
     set last_message_at = now(), last_message_preview = left(coalesce(nullif(p_text, ''), '📎'), 200),
         unread_count = 0, ai_mode = 'human', handoff_at = coalesce(handoff_at, now())
   where id = conv.id;
  return jsonb_build_object('ok', true, 'conversation_id', conv.id, 'message_id', mid, 'owner', true, 'organization_id', acc.organization_id);
end;
$fn$;
revoke all on function public.ingest_owner_message_meta(text, text, text, text, text, jsonb) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.social_comments, public.social_posts, public.social_settings to service_role';
    execute 'grant execute on function public.claim_due_social_posts(int), public.outbound_guard(uuid, text, uuid, boolean), public.ingest_owner_message_meta(text, text, text, text, text, jsonb), public.record_social_comment(uuid, text, text, text, text, text, text, text, text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
