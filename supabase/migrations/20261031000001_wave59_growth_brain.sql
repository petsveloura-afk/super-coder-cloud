-- Wave 59 — a smarter agent, less setup, more revenue:
--   • the agent learns from the owner's own answers (suggestions the owner approves → the agent's FAQ)
--   • weekly AI coach reports (why conversations did not close + how to fix the script)
--   • A/B test of the agent's opening line (which opener closes more leads)
--   • phone: missed-call text-back, reminder / callback calls, call recordings
--   • connection health alerts, payment links inside the chat, smart review requests, minute packs
-- Additive and idempotent: new tables (RLS on, the server writes), nullable columns, one widened check,
-- and one re-created function that keeps its previous behaviour for every existing pack.

-- ------------------------------------------------------------ learning from the owner ----
create table if not exists public.ai_learning_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid,
  in_message_id uuid unique,
  out_message_id uuid,
  question text not null check (char_length(question) between 2 and 600),
  answer text not null check (char_length(answer) between 2 and 1500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);
create index if not exists ai_learning_suggestions_org on public.ai_learning_suggestions (organization_id, status, created_at desc);
alter table public.ai_learning_suggestions enable row level security;
drop policy if exists ai_learning_suggestions_read on public.ai_learning_suggestions;
create policy ai_learning_suggestions_read on public.ai_learning_suggestions for select to authenticated
  using (public.has_permission(organization_id, 'ai.manage'));
revoke insert, update, delete on public.ai_learning_suggestions from anon, authenticated;
grant select on public.ai_learning_suggestions to authenticated;

-- a person from the business answered a customer's question (inbox or the owner's own phone) → a suggestion
create or replace function public.messages_learning_suggestion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q record;
  ans text;
begin
  begin
    if new.direction <> 'out' or new.ai_agent_id is not null then return new; end if;
    if coalesce(new.meta ->> 'system', '') <> '' or coalesce(new.meta ->> 'fallback', '') = 'true' then return new; end if;
    if new.sent_by is null and coalesce(new.meta ->> 'owner', '') <> 'true' then return new; end if;
    ans := btrim(coalesce(new.body, ''));
    if char_length(ans) < 12 or char_length(ans) > 1500 then return new; end if;
    select m.id, m.body, m.created_at into q
      from public.messages m
     where m.conversation_id = new.conversation_id and m.direction = 'in' and m.created_at <= new.created_at
     order by m.created_at desc
     limit 1;
    if q.id is null or q.created_at < new.created_at - interval '24 hours' then return new; end if;
    if char_length(btrim(coalesce(q.body, ''))) not between 4 and 600 then return new; end if;
    -- only real questions (prices, hours, how / when / where, availability …)
    if q.body !~* '(\?|^\s*(כמה|מה|איך|מתי|איפה|האם|יש|אפשר|למה|מי|ما|كم|كيف|متى|أين|هل|how|what|when|where|why|do you|can i|can you|is there|are you)(\s|$|,)|מחיר|עולה|price|cost|سعر)' then
      return new;
    end if;
    insert into public.ai_learning_suggestions (organization_id, conversation_id, in_message_id, out_message_id, question, answer)
    values (new.organization_id, new.conversation_id, q.id, new.id, left(btrim(q.body), 600), left(ans, 1500))
    on conflict (in_message_id) do update
      set answer = left(public.ai_learning_suggestions.answer || E'\n' || excluded.answer, 1500), out_message_id = excluded.out_message_id
      where public.ai_learning_suggestions.status = 'pending';
  exception when others then
    null; -- learning is a bonus: a message is never blocked by it
  end;
  return new;
end;
$$;
drop trigger if exists messages_learning_suggestion on public.messages;
create trigger messages_learning_suggestion after insert on public.messages
  for each row execute function public.messages_learning_suggestion();

-- ------------------------------------------------------------ weekly AI coach ----
create table if not exists public.ai_coach_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  week_start date not null,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  insights jsonb not null default '{}'::jsonb check (jsonb_typeof(insights) = 'object' and pg_column_size(insights) < 60000),
  created_at timestamptz not null default now(),
  unique (organization_id, week_start)
);
alter table public.ai_coach_reports enable row level security;
drop policy if exists ai_coach_reports_read on public.ai_coach_reports;
create policy ai_coach_reports_read on public.ai_coach_reports for select to authenticated
  using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.ai_coach_reports from anon, authenticated;
grant select on public.ai_coach_reports to authenticated;

-- ------------------------------------------------------------ A/B opening line ----
alter table public.conversations add column if not exists opener_variant smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_opener_variant_check') then
    alter table public.conversations add constraint conversations_opener_variant_check check (opener_variant is null or opener_variant in (0, 1));
  end if;
end $$;
create index if not exists conversations_opener_ab on public.conversations (organization_id, opener_variant, created_at) where opener_variant is not null;

-- ------------------------------------------------------------ phone ----
alter table public.voice_calls add column if not exists purpose text;
alter table public.voice_calls add column if not exists purpose_ref uuid;
alter table public.voice_calls add column if not exists recording_sid text;
alter table public.voice_calls add column if not exists recording_url text;
alter table public.voice_calls add column if not exists recording_sec int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voice_calls_purpose_check') then
    alter table public.voice_calls add constraint voice_calls_purpose_check check (purpose is null or purpose in ('reminder', 'callback', 'test', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'voice_calls_recording_check') then
    alter table public.voice_calls add constraint voice_calls_recording_check check (
      (recording_sid is null or recording_sid ~ '^RE[0-9a-fA-F]{32}$')
      and (recording_url is null or (char_length(recording_url) <= 500 and recording_url ~ '^https://'))
      and (recording_sec is null or recording_sec >= 0));
  end if;
end $$;
create index if not exists voice_calls_purpose_ref on public.voice_calls (organization_id, purpose, purpose_ref) where purpose is not null;

create table if not exists public.phone_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  missed_text boolean not null default true,
  missed_message text check (missed_message is null or char_length(missed_message) <= 500),
  record_calls boolean not null default false,
  reminder_calls boolean not null default false,
  callback_calls boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.phone_settings enable row level security;
drop policy if exists phone_settings_read on public.phone_settings;
create policy phone_settings_read on public.phone_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists phone_settings_insert on public.phone_settings;
create policy phone_settings_insert on public.phone_settings for insert to authenticated
  with check (public.has_permission(organization_id, 'ai.manage'));
drop policy if exists phone_settings_update on public.phone_settings;
create policy phone_settings_update on public.phone_settings for update to authenticated
  using (public.has_permission(organization_id, 'ai.manage')) with check (public.has_permission(organization_id, 'ai.manage'));
revoke delete on public.phone_settings from anon, authenticated;
grant select, insert, update on public.phone_settings to authenticated;

-- ------------------------------------------------------------ connection health alerts ----
create table if not exists public.channel_alerts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid,
  kind text not null check (char_length(kind) between 2 and 40),
  created_at timestamptz not null default now()
);
create index if not exists channel_alerts_recent on public.channel_alerts (organization_id, account_id, kind, created_at desc);
alter table public.channel_alerts enable row level security;
drop policy if exists channel_alerts_read on public.channel_alerts;
create policy channel_alerts_read on public.channel_alerts for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage'));
revoke insert, update, delete on public.channel_alerts from anon, authenticated;
grant select on public.channel_alerts to authenticated;

-- ------------------------------------------------------------ payment inside the chat ----
create table if not exists public.chat_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid,
  document_id uuid not null unique,
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'ILS',
  description text not null default '' check (char_length(description) <= 200),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists chat_payments_conv on public.chat_payments (organization_id, conversation_id, created_at desc);
alter table public.chat_payments enable row level security;
drop policy if exists chat_payments_read on public.chat_payments;
create policy chat_payments_read on public.chat_payments for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.chat_payments from anon, authenticated;
grant select on public.chat_payments to authenticated;

-- the invoice behind a chat payment link was paid → the chat shows "paid" and the team hears about it
create or replace function public.documents_chat_payment_paid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cp public.chat_payments;
begin
  begin
    if new.status = 'paid' and coalesce(old.status, '') <> 'paid' then
      update public.chat_payments set status = 'paid', paid_at = now()
       where document_id = new.id and status = 'pending'
       returning * into cp;
      if cp.id is not null then
        insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
        select cp.organization_id, m.user_id, 'inbox', 'payChat.paidNotification',
               jsonb_build_object('amount', cp.amount::text, 'currency', cp.currency, 'description', left(cp.description, 80)),
               case when cp.conversation_id is null then '/finance' else '/inbox?c=' || cp.conversation_id end
          from public.organization_members m
         where m.organization_id = cp.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'sales');
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
drop trigger if exists documents_chat_payment_paid on public.documents;
create trigger documents_chat_payment_paid after update of status on public.documents
  for each row execute function public.documents_chat_payment_paid();

-- ------------------------------------------------------------ smart review requests ----
create table if not exists public.review_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  review_url text check (review_url is null or (char_length(review_url) <= 500 and review_url ~ '^https://')),
  status text not null default 'asked' check (status in ('asked', 'positive', 'negative', 'expired')),
  rating smallint check (rating is null or rating between 1 and 5),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists review_gates_open on public.review_gates (organization_id, contact_id, created_at desc) where status = 'asked';
alter table public.review_gates enable row level security;
drop policy if exists review_gates_read on public.review_gates;
create policy review_gates_read on public.review_gates for select to authenticated
  using (public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.review_gates from anon, authenticated;
grant select on public.review_gates to authenticated;

-- ------------------------------------------------------------ phone minute packs ----
alter table public.credit_ledger drop constraint if exists credit_ledger_kind_check;
alter table public.credit_ledger add constraint credit_ledger_kind_check check (kind in ('ai', 'voice'));

-- same as before for AI packs; packs whose key starts with "min_" add phone minutes instead of AI credits
create or replace function public.grant_credit_purchase(p_purchase uuid, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cp public.credit_purchases;
  minutes boolean;
begin
  select * into cp from public.credit_purchases where id = p_purchase for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if cp.status = 'paid' then return jsonb_build_object('ok', true, 'already', true, 'credits', cp.credits); end if;
  if upper(coalesce(p_currency, '')) <> upper(cp.currency) or coalesce(p_amount, 0) + 0.01 < cp.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;
  minutes := cp.pack like 'min\_%';
  update public.credit_purchases set status = 'paid', paid_at = now() where id = cp.id;
  insert into public.credit_ledger (organization_id, kind, delta, reason, purchase_id, created_by)
  values (cp.organization_id, case when minutes then 'voice' else 'ai' end, cp.credits, 'purchase', cp.id, cp.created_by)
  on conflict do nothing;
  insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
  select cp.organization_id, m.user_id, 'billing',
         case when minutes then 'phone.minutesAddedNotification' else 'credits.addedNotification' end,
         case when minutes then jsonb_build_object('minutes', cp.credits) else jsonb_build_object('credits', cp.credits) end,
         case when minutes then '/phone' else '/billing' end
    from public.organization_members m
   where m.organization_id = cp.organization_id and m.role in ('agency_owner', 'owner', 'admin');
  return jsonb_build_object('ok', true, 'credits', cp.credits, 'minutes', minutes);
end;
$$;
revoke all on function public.grant_credit_purchase(uuid, numeric, text) from public, anon, authenticated;

-- purchased phone minutes left (used only after the monthly platform minutes)
create or replace function public.voice_minutes_balance(org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(0, coalesce(sum(delta), 0)) from public.credit_ledger where organization_id = org and kind = 'voice';
$$;
revoke all on function public.voice_minutes_balance(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
