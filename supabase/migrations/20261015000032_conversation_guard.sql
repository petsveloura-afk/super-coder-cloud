-- =============================================================================
-- Conversation guard — ONE state for every channel (additive only).
--
-- Every automated message (AI reply, follow-up, scheduled message, campaign,
-- automation, reminder) asks outbound_guard() first:
--   * consent      the customer wrote STOP / הסר / إلغاء → nothing automated is
--                  sent any more (until he writes START / חזרה)
--   * ownership    a person took the conversation (ai_mode = human / owner takeover)
--   * human first  a team member already answered after the customer's last message
--                  — on ANY channel of the same customer
--   * attempts     how many follow-ups were sent since the customer last wrote,
--                  minimum gap between automated messages, daily cap per customer
--   * windows      WhatsApp official / Telegram Business 24-hour window
--
-- conversation_schedules is the single list of everything that will be sent
-- later (follow-up after N hours, a scheduled message, a sequence step). The
-- database cancels pending items IMMEDIATELY when:
--   - the customer replies (any channel of the same customer)       → customer_replied
--   - a team member replies (any channel of the same customer)      → human_replied
--   - the customer opts out                                         → opted_out
--   - a person takes the conversation                               → human_took_over
-- Decisions that blocked a message are kept in conversation_guard_log.
-- =============================================================================

-- ------------------------------------------------------------------ columns ----
alter table public.contacts add column if not exists opted_out_at timestamptz;
alter table public.conversations add column if not exists opt_out boolean not null default false;
alter table public.conversations add column if not exists last_customer_at timestamptz;
alter table public.conversations add column if not exists last_human_at timestamptz;
alter table public.conversations add column if not exists last_auto_at timestamptz;

-- workspace policy for automated messages (defaults are safe)
alter table public.organizations add column if not exists conversation_policy jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.organizations add constraint organizations_conversation_policy_object
    check (jsonb_typeof(conversation_policy) = 'object' and pg_column_size(conversation_policy) < 8000);
exception when duplicate_object then null; end $$;

-- backfill the conversation state from existing messages
update public.conversations c set
  last_customer_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.direction = 'in'),
  last_human_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.direction = 'out'
                    and (m.sent_by is not null or coalesce(m.meta ->> 'owner', '') = 'true')),
  last_auto_at = (select max(m.created_at) from public.messages m where m.conversation_id = c.id and m.direction = 'out'
                   and m.sent_by is null and coalesce(m.meta ->> 'owner', '') <> 'true')
 where c.last_customer_at is null and c.last_human_at is null and c.last_auto_at is null;

-- ------------------------------------------------------------ the policy ----
-- effective policy of a workspace (defaults merged with what the business set)
create or replace function public.conversation_policy(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
      'followup_max', 1,          -- follow-ups per silence (after the customer's last message)
      'followup_gap_hours', 24,   -- between two follow-ups of the same silence
      'min_gap_minutes', 2,       -- between two automated messages to the same customer
      'daily_cap', 12,            -- automated messages per customer per 24h (all channels)
      'quiet_start', null,        -- "22:00": no follow-ups / scheduled marketing at night
      'quiet_end', null,          -- "08:00"
      'opt_out_reply', true       -- confirm the opt-out once
    ) || coalesce((select conversation_policy from public.organizations where id = p_org), '{}'::jsonb);
$$;
revoke all on function public.conversation_policy(uuid) from public, anon;
grant execute on function public.conversation_policy(uuid) to authenticated, service_role;

-- STOP / START words — the whole message, not a phrase inside a sentence
create or replace function public.is_opt_out_text(p text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '[\s\.\!\?״"''׳]+$', '')) = any (array[
    'stop', 'stop all', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'opt out', 'optout', 'remove me',
    'הסר', 'הסרה', 'להסיר', 'הסירו', 'הסירו אותי', 'תסירו', 'תסירו אותי', 'הסר אותי', 'די', 'עצור', 'תפסיקו', 'הפסיקו', 'לא לשלוח', 'ביטול הרשמה',
    'إلغاء', 'الغاء', 'توقف', 'أوقف', 'الغاء الاشتراك', 'إلغاء الاشتراك', 'stop please']);
$$;

create or replace function public.is_opt_in_text(p text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '[\s\.\!\?]+$', '')) = any (array[
    'start', 'unstop', 'subscribe', 'resume', 'חזרה', 'הצטרף', 'הצטרפות', 'להצטרף', 'הרשמה', 'اشتراك', 'اشترك', 'ابدأ']);
$$;

-- -------------------------------------------------------------- schedules ----
create table if not exists public.conversation_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  contact_id uuid,
  kind text not null check (kind in ('followup', 'scheduled', 'sequence', 'reminder')),
  body text check (body is null or char_length(body) <= 4000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'canceled', 'skipped', 'failed')),
  cancel_on_reply boolean not null default true,
  step int not null default 1 check (step between 1 and 20),
  reason text check (reason is null or char_length(reason) <= 200),
  attempts int not null default 0,
  message_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade
);
create index if not exists conversation_schedules_due on public.conversation_schedules (run_at) where status = 'pending';
create index if not exists conversation_schedules_conv on public.conversation_schedules (conversation_id, status);
create index if not exists conversation_schedules_contact on public.conversation_schedules (contact_id, status) where contact_id is not null;
alter table public.conversation_schedules enable row level security;
drop policy if exists conversation_schedules_read on public.conversation_schedules;
create policy conversation_schedules_read on public.conversation_schedules for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.conversation_schedules from anon, authenticated;
grant select on public.conversation_schedules to authenticated;

create table if not exists public.conversation_guard_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid,
  kind text not null check (char_length(kind) <= 30),
  allowed boolean not null,
  reason text not null check (char_length(reason) <= 60),
  created_at timestamptz not null default now()
);
create index if not exists conversation_guard_log_conv on public.conversation_guard_log (conversation_id, created_at desc);
alter table public.conversation_guard_log enable row level security;
drop policy if exists conversation_guard_log_read on public.conversation_guard_log;
create policy conversation_guard_log_read on public.conversation_guard_log for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.conversation_guard_log from anon, authenticated;
grant select on public.conversation_guard_log to authenticated;

-- cancel pending items of a customer (all his conversations) — returns how many
create or replace function public.cancel_pending_schedules(p_org uuid, p_conversation uuid, p_reason text, p_kinds text[] default null, p_only_cancel_on_reply boolean default false)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
  n int;
begin
  select contact_id into cid from public.conversations where id = p_conversation;
  update public.conversation_schedules s
     set status = 'canceled', reason = left(p_reason, 200), updated_at = now()
   where s.organization_id = p_org and s.status = 'pending'
     and (s.conversation_id = p_conversation or (cid is not null and s.contact_id = cid))
     and (p_kinds is null or s.kind = any (p_kinds))
     and (not p_only_cancel_on_reply or s.cancel_on_reply);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.cancel_pending_schedules(uuid, uuid, text, text[], boolean) from public, anon, authenticated;

-- ---------------------------------------------------- one state, every message ----
create or replace function public.messages_conversation_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  human boolean;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  if not found then return null; end if;

  if new.direction = 'in' then
    update public.conversations set last_customer_at = new.created_at where id = conv.id;
    if public.is_opt_out_text(new.body) then
      update public.messages set meta = meta || jsonb_build_object('opt', 'out') where id = new.id;
      update public.conversations set opt_out = true where organization_id = conv.organization_id
        and (id = conv.id or (conv.contact_id is not null and contact_id = conv.contact_id));
      if conv.contact_id is not null then
        update public.contacts set opted_out_at = now(), marketing_consent = false where id = conv.contact_id;
        insert into public.activities (organization_id, contact_id, type, payload)
        values (conv.organization_id, conv.contact_id, 'contact.opted_out', jsonb_build_object('channel', conv.channel));
      end if;
      perform public.cancel_pending_schedules(conv.organization_id, conv.id, 'opted_out', null, false);
    elsif public.is_opt_in_text(new.body) and conv.opt_out then
      update public.messages set meta = meta || jsonb_build_object('opt', 'in') where id = new.id;
      update public.conversations set opt_out = false where organization_id = conv.organization_id
        and (id = conv.id or (conv.contact_id is not null and contact_id = conv.contact_id));
      if conv.contact_id is not null then
        update public.contacts set opted_out_at = null where id = conv.contact_id;
        insert into public.activities (organization_id, contact_id, type, payload)
        values (conv.organization_id, conv.contact_id, 'contact.opted_in', jsonb_build_object('channel', conv.channel));
      end if;
    else
      -- the customer answered: every pending "if he doesn't answer" item is void — on all his channels
      perform public.cancel_pending_schedules(conv.organization_id, conv.id, 'customer_replied', null, true);
    end if;
    return null;
  end if;

  human := new.sent_by is not null or coalesce(new.meta ->> 'owner', '') = 'true';
  if human then
    update public.conversations set last_human_at = new.created_at where id = conv.id;
    -- a person answered: automated follow-ups stop (scheduled messages a person wrote stay)
    perform public.cancel_pending_schedules(conv.organization_id, conv.id, 'human_replied', array['followup', 'sequence'], false);
  else
    update public.conversations set last_auto_at = new.created_at where id = conv.id;
    -- the AI agent answered: plan the follow-up of this silence (its own "follow up after N hours")
    if new.ai_agent_id is not null and coalesce(new.meta ->> 'followup', '') <> 'true' and coalesce(new.meta ->> 'fallback', '') <> 'true'
       and coalesce(new.meta ->> 'system', '') = '' then
      perform public.plan_followup(conv.id, (select a.followup_hours from public.ai_agents a where a.id = new.ai_agent_id), 1);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists messages_conversation_state on public.messages;
create trigger messages_conversation_state after insert on public.messages
  for each row execute function public.messages_conversation_state();

-- a person took the conversation → automated follow-ups stop
create or replace function public.conversations_takeover_cancels()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.ai_mode = 'human' and old.ai_mode is distinct from 'human' then
    perform public.cancel_pending_schedules(new.organization_id, new.id, 'human_took_over', array['followup', 'sequence'], false);
  end if;
  return null;
end;
$$;
drop trigger if exists conversations_takeover_cancels on public.conversations;
create trigger conversations_takeover_cancels after update of ai_mode on public.conversations
  for each row execute function public.conversations_takeover_cancels();

-- -------------------------------------------------------------- the guard ----
-- kind: ai_reply | followup | scheduled | sequence | campaign | automation | reminder | human
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
  -- 6. 24-hour windows (official WhatsApp, Telegram Business) for messages the customer did not just ask for
  if reason is null and p_kind in ('followup', 'sequence', 'scheduled', 'automation')
     and (conv.channel = 'whatsapp' or conv.business_connection_id is not null)
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

-- automations / reminders that reach a CONTACT (no conversation yet): consent only
create or replace function public.contact_can_receive(p_contact uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  ct public.contacts;
begin
  select * into ct from public.contacts where id = p_contact;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  if ct.opted_out_at is not null and p_kind <> 'reminder' then return jsonb_build_object('allowed', false, 'reason', 'opted_out'); end if;
  if p_kind in ('campaign', 'sequence') and not ct.marketing_consent then return jsonb_build_object('allowed', false, 'reason', 'no_consent'); end if;
  if p_kind = 'automation' and exists (select 1 from public.conversations c where c.contact_id = p_contact and c.opt_out) then
    return jsonb_build_object('allowed', false, 'reason', 'opted_out');
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'ok');
end;
$$;
revoke all on function public.contact_can_receive(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------- follow-ups ----
-- after an AI / automated answer, plan the follow-up of this silence (one pending per customer)
create or replace function public.plan_followup(p_conversation uuid, p_hours numeric, p_step int default 1)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  sid uuid;
begin
  if p_hours is null or p_hours <= 0 then return null; end if;
  select * into conv from public.conversations where id = p_conversation;
  if not found or conv.channel = 'web' or conv.opt_out or conv.ai_mode = 'human' then return null; end if;
  -- one pending follow-up per customer: replace the previous plan
  update public.conversation_schedules set status = 'canceled', reason = 'replanned', updated_at = now()
   where organization_id = conv.organization_id and status = 'pending' and kind = 'followup'
     and (conversation_id = conv.id or (conv.contact_id is not null and contact_id = conv.contact_id));
  insert into public.conversation_schedules (organization_id, conversation_id, contact_id, kind, run_at, step, cancel_on_reply)
  values (conv.organization_id, conv.id, conv.contact_id, 'followup', now() + make_interval(mins => round(p_hours * 60)::int), greatest(1, least(p_step, 20)), true)
  returning id into sid;
  return sid;
end;
$$;
revoke all on function public.plan_followup(uuid, numeric, int) from public, anon, authenticated;

-- due items, claimed atomically (no double send between overlapping runs)
create or replace function public.claim_due_schedules(p_limit int default 30)
returns setof public.conversation_schedules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- items stuck in "processing" (a crashed run) go back to the queue after 10 minutes
  update public.conversation_schedules set status = 'pending', updated_at = now()
   where status = 'processing' and updated_at < now() - interval '10 minutes' and attempts < 3;
  return query
  with due as (
    select s.id from public.conversation_schedules s
     where s.status = 'pending' and s.run_at <= now()
     order by s.run_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  )
  update public.conversation_schedules s set status = 'processing', attempts = s.attempts + 1, updated_at = now()
    from due where s.id = due.id
  returning s.*;
end;
$$;
revoke all on function public.claim_due_schedules(int) from public, anon, authenticated;

create or replace function public.finish_schedule(p_id uuid, p_status text, p_reason text default null, p_message uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'canceled', 'skipped', 'failed', 'pending') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  update public.conversation_schedules
     set status = p_status, reason = left(p_reason, 200), message_id = coalesce(p_message, message_id), updated_at = now(),
         run_at = case when p_status = 'pending' then now() + interval '5 minutes' else run_at end
   where id = p_id and status = 'processing';
end;
$$;
revoke all on function public.finish_schedule(uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------- team: schedule / cancel ----
create or replace function public.schedule_conversation_message(p_conversation uuid, p_body text, p_run_at timestamptz, p_cancel_on_reply boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  sid uuid;
begin
  select * into conv from public.conversations where id = p_conversation;
  if not found or not public.has_permission(conv.organization_id, 'inbox.reply') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body, '')) = '' or char_length(p_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_run_at is null or p_run_at < now() - interval '1 minute' or p_run_at > now() + interval '180 days' then
    raise exception 'invalid_time' using errcode = '22023';
  end if;
  if (select count(*) from public.conversation_schedules where conversation_id = conv.id and status = 'pending') >= 20 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  insert into public.conversation_schedules (organization_id, conversation_id, contact_id, kind, body, run_at, cancel_on_reply, created_by)
  values (conv.organization_id, conv.id, conv.contact_id, 'scheduled', btrim(p_body), p_run_at, coalesce(p_cancel_on_reply, true), auth.uid())
  returning id into sid;
  return sid;
end;
$$;
revoke all on function public.schedule_conversation_message(uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.schedule_conversation_message(uuid, text, timestamptz, boolean) to authenticated;

create or replace function public.cancel_conversation_schedule(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.conversation_schedules;
begin
  select * into s from public.conversation_schedules where id = p_id;
  if not found or not public.has_permission(s.organization_id, 'inbox.reply') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.conversation_schedules set status = 'canceled', reason = 'canceled_by_team', updated_at = now()
   where id = p_id and status = 'pending';
  return found;
end;
$$;
revoke all on function public.cancel_conversation_schedule(uuid) from public, anon;
grant execute on function public.cancel_conversation_schedule(uuid) to authenticated;

-- the team changes the opt-out by hand (e.g. the customer asked by phone)
create or replace function public.set_conversation_opt_out(p_conversation uuid, p_opt_out boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
begin
  select * into conv from public.conversations where id = p_conversation;
  if not found or not public.has_permission(conv.organization_id, 'inbox.reply') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.conversations set opt_out = p_opt_out where organization_id = conv.organization_id
    and (id = conv.id or (conv.contact_id is not null and contact_id = conv.contact_id));
  if conv.contact_id is not null then
    update public.contacts set opted_out_at = case when p_opt_out then now() else null end,
                               marketing_consent = case when p_opt_out then false else marketing_consent end
     where id = conv.contact_id;
    insert into public.activities (organization_id, contact_id, type, payload, actor_id)
    values (conv.organization_id, conv.contact_id, case when p_opt_out then 'contact.opted_out' else 'contact.opted_in' end,
            jsonb_build_object('by', 'team'), auth.uid());
  end if;
  if p_opt_out then perform public.cancel_pending_schedules(conv.organization_id, conv.id, 'opted_out', null, false); end if;
end;
$$;
revoke all on function public.set_conversation_opt_out(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_opt_out(uuid, boolean) to authenticated;

-- the inbox panel: state + pending items + last blocked decisions (RLS: inbox.read)
create or replace function public.conversation_state(p_conversation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  conv public.conversations;
  g jsonb;
begin
  select * into conv from public.conversations where id = p_conversation;
  if not found or not public.has_permission(conv.organization_id, 'inbox.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  g := public.outbound_guard(conv.id, 'followup', null, false);
  return g || jsonb_build_object(
    'assignee_id', conv.assignee_id,
    'consent', (select marketing_consent from public.contacts where id = conv.contact_id),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'run_at', s.run_at, 'body', left(coalesce(s.body, ''), 200), 'cancel_on_reply', s.cancel_on_reply, 'step', s.step) order by s.run_at)
                           from public.conversation_schedules s
                          where s.status = 'pending' and (s.conversation_id = conv.id or (conv.contact_id is not null and s.contact_id = conv.contact_id))), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
        select jsonb_build_object('kind', s.kind, 'status', s.status, 'reason', s.reason, 'at', s.updated_at) x
          from public.conversation_schedules s
         where s.conversation_id = conv.id and s.status in ('sent', 'canceled', 'skipped', 'failed')
         order by s.updated_at desc limit 6) y), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
                           from (select * from public.conversation_guard_log l where l.conversation_id = conv.id order by l.created_at desc limit 6) l), '[]'::jsonb));
end;
$$;
revoke all on function public.conversation_state(uuid) from public, anon;
grant execute on function public.conversation_state(uuid) to authenticated;

-- workspace policy edited by the team (settings.manage)
create or replace function public.set_conversation_policy(p_org uuid, p_policy jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean jsonb;
begin
  if not public.has_permission(p_org, 'settings.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  clean := jsonb_build_object(
    'followup_max', greatest(1, least(coalesce((p_policy ->> 'followup_max')::int, 1), 5)),
    'followup_gap_hours', greatest(1, least(coalesce((p_policy ->> 'followup_gap_hours')::numeric, 24), 168)),
    'min_gap_minutes', greatest(0, least(coalesce((p_policy ->> 'min_gap_minutes')::int, 2), 1440)),
    'daily_cap', greatest(1, least(coalesce((p_policy ->> 'daily_cap')::int, 12), 100)),
    'quiet_start', case when p_policy ->> 'quiet_start' ~ '^([01]\d|2[0-3]):[0-5]\d$' then p_policy ->> 'quiet_start' end,
    'quiet_end', case when p_policy ->> 'quiet_end' ~ '^([01]\d|2[0-3]):[0-5]\d$' then p_policy ->> 'quiet_end' end,
    'opt_out_reply', coalesce((p_policy ->> 'opt_out_reply')::boolean, true));
  update public.organizations set conversation_policy = clean where id = p_org;
  return clean;
end;
$$;
revoke all on function public.set_conversation_policy(uuid, jsonb) from public, anon;
grant execute on function public.set_conversation_policy(uuid, jsonb) to authenticated;

-- the legacy follow-up candidates also respect the guard (no double follow-up)
create or replace function public.ai_followup_candidates_guarded(p_limit int default 20)
returns table (conversation_id uuid, organization_id uuid, agent_id uuid, channel text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.* from public.ai_followup_candidates(p_limit) f
   where (public.outbound_guard(f.conversation_id, 'followup', null, false) ->> 'allowed')::boolean;
$$;
revoke all on function public.ai_followup_candidates_guarded(int) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.conversation_schedules, public.conversation_guard_log to service_role';
    execute 'grant execute on function public.outbound_guard(uuid, text, uuid, boolean), public.contact_can_receive(uuid, text),
      public.plan_followup(uuid, numeric, int), public.claim_due_schedules(int), public.finish_schedule(uuid, text, text, uuid),
      public.cancel_pending_schedules(uuid, uuid, text, text[], boolean), public.ai_followup_candidates_guarded(int) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
