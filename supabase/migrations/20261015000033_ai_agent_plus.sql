-- =============================================================================
-- Wave 16 — the AI agent, upgraded (additive only).
--
--  * kb_articles           help-center knowledge base: public help pages + the agent
--                          answers support questions from it (full-text search)
--  * ai_agents.guardrails  budget per conversation, forbidden phrases, price check,
--                          hand off on an angry customer
--  * agent_flows           visual conversation flows (steps, buttons, branches) that run
--                          before the free AI; conversations.flow_state keeps the position
--  * calendar_connections  Google / Outlook calendars: meetings are written there, busy
--  * calendar_busy           times from there block online booking (two-way)
--  * voice_calls           phone calls: the AI voice agent (Twilio) + urgent call to the
--                          on-duty team member ("call" recipients)
-- =============================================================================

update public.plans set features = array_append(features, 'voice_ai')
 where key in ('business', 'enterprise') and not ('voice_ai' = any (features));
update public.plans set features = array_append(features, 'calendar_sync')
 where key in ('pro', 'business', 'enterprise') and not ('calendar_sync' = any (features));
update public.plans set features = array_append(features, 'flow_builder')
 where key in ('pro', 'business', 'enterprise') and not ('flow_builder' = any (features));

-- ============================================================ knowledge base ====
create table if not exists public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 200),
  body text not null default '' check (char_length(body) <= 30000),
  category text check (category is null or char_length(category) <= 80),
  published boolean not null default true,
  views int not null default 0,
  helpful int not null default 0,
  position int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category, '') || ' ' || coalesce(body, ''))) stored,
  unique (organization_id, id)
);
create index if not exists kb_articles_org on public.kb_articles (organization_id, published, position);
create index if not exists kb_articles_search on public.kb_articles using gin (search);
alter table public.kb_articles enable row level security;
drop policy if exists kb_articles_select on public.kb_articles;
create policy kb_articles_select on public.kb_articles for select to authenticated using (public.has_permission(organization_id, 'tickets.read'));
drop policy if exists kb_articles_insert on public.kb_articles;
create policy kb_articles_insert on public.kb_articles for insert to authenticated with check (public.has_permission(organization_id, 'tickets.write'));
drop policy if exists kb_articles_update on public.kb_articles;
create policy kb_articles_update on public.kb_articles for update to authenticated
  using (public.has_permission(organization_id, 'tickets.write')) with check (public.has_permission(organization_id, 'tickets.write'));
drop policy if exists kb_articles_delete on public.kb_articles;
create policy kb_articles_delete on public.kb_articles for delete to authenticated using (public.has_permission(organization_id, 'tickets.write'));
grant select, insert, update, delete on public.kb_articles to authenticated;
drop trigger if exists kb_articles_updated_at on public.kb_articles;
create trigger kb_articles_updated_at before update on public.kb_articles for each row execute function public.set_updated_at();

-- ranked search: words as OR, prefix matching, title weighted; falls back to ILIKE
create or replace function public.kb_search(p_org uuid, p_query text, p_limit int default 4)
returns table (id uuid, title text, body text, category text, rank real)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  words text[];
  q tsquery;
begin
  select array_agg(w) into words from (
    select regexp_replace(lower(w), '[^[:alnum:]א-ת؀-ۿ]+', '', 'g') w
      from regexp_split_to_table(coalesce(p_query, ''), '\s+') w
  ) s where char_length(w) >= 2;
  if words is null then return; end if;
  q := to_tsquery('simple', array_to_string(array(select quote_literal(w) || ':*' from unnest(words[1:12]) w), ' | '));
  return query
    select a.id, a.title, left(a.body, 4000), a.category,
           (ts_rank(a.search, q) + case when exists (select 1 from unnest(words) w where lower(a.title) like '%' || w || '%') then 0.5 else 0 end)::real
      from public.kb_articles a
     where a.organization_id = p_org and a.published and a.search @@ q
     order by 5 desc, a.position
     limit greatest(1, least(p_limit, 10));
end;
$$;
revoke all on function public.kb_search(uuid, text, int) from public, anon;
grant execute on function public.kb_search(uuid, text, int) to authenticated, service_role;

-- public help center: published articles of an organization (by its slug)
create or replace function public.get_public_kb(p_org_slug text, p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  o public.organizations;
begin
  select * into o from public.organizations where slug = p_org_slug and deleted_at is null;
  if not found then return null; end if;
  if coalesce(btrim(p_query), '') <> '' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'category', s.category, 'excerpt', left(s.body, 220)))
                       from public.kb_search(o.id, p_query, 10) s), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'category', a.category, 'excerpt', left(a.body, 220)) order by a.category nulls last, a.position, a.title)
                     from public.kb_articles a where a.organization_id = o.id and a.published), '[]'::jsonb);
end;
$$;
create or replace function public.get_public_kb_article(p_org_slug text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.kb_articles;
begin
  select k.* into a from public.kb_articles k join public.organizations o on o.id = k.organization_id
   where o.slug = p_org_slug and k.id = p_id and k.published;
  if not found then return null; end if;
  update public.kb_articles set views = views + 1 where id = a.id;
  return jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'category', a.category, 'updated_at', a.updated_at);
end;
$$;
create or replace function public.kb_article_helpful(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.kb_articles set helpful = helpful + 1 where id = p_id and published
     and public.public_rate_limit('kbhelp:' || p_id, 50, 3600);
$$;
revoke all on function public.get_public_kb(text, text), public.get_public_kb_article(text, uuid), public.kb_article_helpful(uuid) from public;
grant execute on function public.get_public_kb(text, text), public.get_public_kb_article(text, uuid), public.kb_article_helpful(uuid) to anon, authenticated, service_role;

-- ================================================================ guardrails ====
alter table public.ai_agents add column if not exists guardrails jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.ai_agents add constraint ai_agents_guardrails_object check (jsonb_typeof(guardrails) = 'object' and pg_column_size(guardrails) < 20000);
exception when duplicate_object then null; end $$;

-- AI replies of one agent in one conversation in the last 24h (budget per conversation)
create or replace function public.ai_replies_today(p_conversation uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.messages
   where conversation_id = p_conversation and direction = 'out' and ai_agent_id is not null and created_at > now() - interval '24 hours';
$$;
revoke all on function public.ai_replies_today(uuid) from public, anon, authenticated;

-- ===================================================================== flows ====
create table if not exists public.agent_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  enabled boolean not null default true,
  -- when the flow starts: keywords in the customer's message, and/or the first message of a new conversation
  trigger_keywords text[] not null default '{}'::text[],
  on_first_message boolean not null default false,
  -- [{id, type: message|question|buttons|collect|handoff|ai|end, text, buttons:[{label,next}], field, next}]
  nodes jsonb not null default '[]'::jsonb check (jsonb_typeof(nodes) = 'array' and jsonb_array_length(nodes) <= 60 and pg_column_size(nodes) < 120000),
  runs int not null default 0,
  completions int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references public.ai_agents (organization_id, id) on delete cascade
);
create index if not exists agent_flows_org on public.agent_flows (organization_id, enabled);
alter table public.agent_flows enable row level security;
drop policy if exists agent_flows_select on public.agent_flows;
create policy agent_flows_select on public.agent_flows for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
drop policy if exists agent_flows_write on public.agent_flows;
create policy agent_flows_write on public.agent_flows for all to authenticated
  using (public.has_permission(organization_id, 'ai.manage')) with check (public.has_permission(organization_id, 'ai.manage'));
grant select, insert, update, delete on public.agent_flows to authenticated;
drop trigger if exists agent_flows_updated_at on public.agent_flows;
create trigger agent_flows_updated_at before update on public.agent_flows for each row execute function public.set_updated_at();

create or replace function public.increment_flow_counter(p_flow uuid, p_field text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_field = 'runs' then update public.agent_flows set runs = runs + 1 where id = p_flow;
  elsif p_field = 'completions' then update public.agent_flows set completions = completions + 1 where id = p_flow;
  end if;
end;
$$;
revoke all on function public.increment_flow_counter(uuid, text) from public, anon, authenticated;

alter table public.conversations add column if not exists flow_state jsonb;
do $$ begin
  alter table public.conversations add constraint conversations_flow_state_object check (flow_state is null or (jsonb_typeof(flow_state) = 'object' and pg_column_size(flow_state) < 10000));
exception when duplicate_object then null; end $$;

-- ================================================================= calendars ====
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text check (account_email is null or char_length(account_email) <= 254),
  calendar_id text not null default 'primary' check (char_length(calendar_id) <= 300),
  secret_enc text,                         -- refresh / access token (AES-GCM), never readable by users
  push_events boolean not null default true,
  block_busy boolean not null default true,
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  last_sync_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);
alter table public.calendar_connections enable row level security;
drop policy if exists calendar_connections_own on public.calendar_connections;
create policy calendar_connections_own on public.calendar_connections for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
revoke all on public.calendar_connections from anon, authenticated;
grant select (id, organization_id, user_id, provider, account_email, calendar_id, push_events, block_busy, status, last_sync_at, last_error, created_at, updated_at)
  on public.calendar_connections to authenticated;

create table if not exists public.calendar_busy (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);
create index if not exists calendar_busy_user on public.calendar_busy (user_id, starts_at);
alter table public.calendar_busy enable row level security;
revoke all on public.calendar_busy from anon, authenticated;

alter table public.appointments add column if not exists external_event jsonb;

-- booking page: busy times also from the host's connected calendars
create or replace function public.get_public_booking_v2(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  base jsonb;
  t public.appointment_types;
begin
  base := public.get_public_booking(p_slug);
  if base is null then return null; end if;
  select * into t from public.appointment_types where slug = p_slug and status = 'active';
  return jsonb_set(base, '{busy}', coalesce((
    select jsonb_agg(x order by x ->> 0) from (
      select e as x from jsonb_array_elements(base -> 'busy') e
      union all
      select jsonb_build_array(b.starts_at, b.ends_at) from public.calendar_busy b
       where b.user_id = t.host_id and b.ends_at > now() and b.starts_at < now() + make_interval(days => t.max_days_ahead + 1)
    ) u), '[]'::jsonb));
end;
$$;
revoke all on function public.get_public_booking_v2(text) from public;
grant execute on function public.get_public_booking_v2(text) to anon, authenticated, service_role;

create or replace function public.book_appointment_v2(p_slug text, p_start timestamptz, p_name text, p_email text, p_phone text, p_notes text, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  t public.appointment_types;
  st timestamptz := date_trunc('minute', p_start);
begin
  select * into t from public.appointment_types where slug = p_slug and status = 'active';
  if found and exists (
    select 1 from public.calendar_busy b
     where b.user_id = t.host_id
       and tstzrange(b.starts_at - make_interval(mins => t.buffer_min), b.ends_at + make_interval(mins => t.buffer_min), '[)')
           && tstzrange(st, st + make_interval(mins => t.duration_min), '[)')) then
    return jsonb_build_object('ok', false, 'error', 'booking.taken');
  end if;
  return public.book_appointment(p_slug, p_start, p_name, p_email, p_phone, p_notes, p_meta);
end;
$$;
revoke all on function public.book_appointment_v2(text, timestamptz, text, text, text, text, jsonb) from public;
grant execute on function public.book_appointment_v2(text, timestamptz, text, text, text, text, jsonb) to anon, authenticated, service_role;

-- every change to a meeting → write it to the host's calendar (job "calendar")
create or replace function public.appointments_calendar_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.host_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at
     and new.status is not distinct from old.status and new.title is not distinct from old.title then
    return null;
  end if;
  if exists (select 1 from public.calendar_connections c where c.user_id = new.host_id and c.organization_id = new.organization_id and c.push_events and c.status = 'active') then
    insert into public.jobs (organization_id, kind, payload) values (new.organization_id, 'calendar', jsonb_build_object('appointment_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists appointments_calendar_job on public.appointments;
create trigger appointments_calendar_job after insert or update on public.appointments
  for each row execute function public.appointments_calendar_job();

-- ===================================================================== voice ====
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.notify_recipients'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%' and pg_get_constraintdef(oid) ilike '%telegram%'
              and pg_get_constraintdef(oid) not ilike '%target%'   -- keep "telegram or target is not null"
  loop
    execute format('alter table public.notify_recipients drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.notify_recipients add constraint notify_recipients_kind_check check (kind in ('email', 'telegram', 'whatsapp', 'sms', 'call'));

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid,
  contact_id uuid,
  direction text not null check (direction in ('in', 'out', 'alert')),
  from_number text check (from_number is null or char_length(from_number) <= 40),
  to_number text check (to_number is null or char_length(to_number) <= 40),
  call_sid text unique check (call_sid is null or char_length(call_sid) <= 80),
  status text not null default 'started' check (char_length(status) <= 30),
  turns jsonb not null default '[]'::jsonb check (jsonb_typeof(turns) = 'array' and pg_column_size(turns) < 200000),
  summary text check (summary is null or char_length(summary) <= 2000),
  duration_sec int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete set null (conversation_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);
create index if not exists voice_calls_org on public.voice_calls (organization_id, created_at desc);
alter table public.voice_calls enable row level security;
drop policy if exists voice_calls_read on public.voice_calls;
create policy voice_calls_read on public.voice_calls for select to authenticated using (public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.voice_calls from anon, authenticated;
grant select on public.voice_calls to authenticated;

-- conversations can also be phone calls
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%channel%' and pg_get_constraintdef(oid) ilike '%whatsapp%'
  loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'telegram', 'sms', 'whatsapp_qr', 'email', 'web', 'telegram_user', 'voice'));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.kb_articles, public.agent_flows, public.calendar_connections, public.calendar_busy, public.voice_calls to service_role';
    execute 'grant execute on function public.ai_replies_today(uuid), public.increment_flow_counter(uuid, text) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
