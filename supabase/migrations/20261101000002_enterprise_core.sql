-- Enterprise core (upgrade spec): operations visibility, saved views, customer satisfaction surveys.
--   • job_runs      — every background job run (start / finish / items / error) + a lock against double runs
--   • app_errors    — server & browser errors, grouped (no PII: message, route, digest only)
--   • saved_views   — personal / shared filters for lists (contacts, companies, deals, tasks, conversations)
--   • survey_settings + survey_responses — automatic NPS / CSAT / CES after a conversation is closed
-- Additive and idempotent: new tables (RLS on), new functions, one new trigger. Nothing existing is changed.

-- ------------------------------------------------------------ background job runs ----
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int,
  items int not null default 0,
  error text check (error is null or char_length(error) <= 1000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index if not exists job_runs_name_started on public.job_runs (name, started_at desc);
create index if not exists job_runs_started on public.job_runs (started_at desc);
alter table public.job_runs enable row level security;
drop policy if exists job_runs_read on public.job_runs;
create policy job_runs_read on public.job_runs for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete on public.job_runs from anon, authenticated;
grant select on public.job_runs to authenticated;

-- starts a run unless the same job is already running (a run older than p_stale_minutes counts as dead)
create or replace function public.start_job_run(p_name text, p_stale_minutes int default 10)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('job_run:' || p_name));
  if exists (
    select 1 from public.job_runs
     where name = p_name and status = 'running'
       and started_at > now() - make_interval(mins => greatest(1, least(p_stale_minutes, 120)))
  ) then
    return null;
  end if;
  update public.job_runs set status = 'error', finished_at = now(), error = 'stale: never finished'
   where name = p_name and status = 'running';
  insert into public.job_runs (name) values (left(p_name, 60)) returning id into rid;
  return rid;
end;
$$;

create or replace function public.finish_job_run(p_id uuid, p_status text, p_items int default 0, p_error text default null, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.job_runs
     set status = case when p_status in ('ok', 'error', 'skipped') then p_status else 'error' end,
         finished_at = now(),
         duration_ms = (extract(epoch from (now() - started_at)) * 1000)::int,
         items = greatest(0, coalesce(p_items, 0)),
         error = left(p_error, 1000),
         details = case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end
   where id = p_id;
  -- keep the table small: 30 days of history
  delete from public.job_runs where started_at < now() - interval '30 days';
$$;
revoke all on function public.start_job_run(text, int) from public, anon, authenticated;
revoke all on function public.finish_job_run(uuid, text, int, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ application errors ----
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null check (char_length(fingerprint) <= 120),
  source text not null check (source in ('server', 'client', 'job')),
  route text check (route is null or char_length(route) <= 300),
  message text not null check (char_length(message) <= 1000),
  digest text check (digest is null or char_length(digest) <= 120),
  organization_id uuid references public.organizations (id) on delete set null,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved boolean not null default false
);
create unique index if not exists app_errors_fingerprint on public.app_errors (fingerprint);
create index if not exists app_errors_last_seen on public.app_errors (last_seen desc);
alter table public.app_errors enable row level security;
drop policy if exists app_errors_read on public.app_errors;
create policy app_errors_read on public.app_errors for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete on public.app_errors from anon, authenticated;
grant select on public.app_errors to authenticated;

create or replace function public.record_app_error(p_fingerprint text, p_source text, p_route text, p_message text, p_digest text, p_org uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.app_errors (fingerprint, source, route, message, digest, organization_id)
  values (left(p_fingerprint, 120), case when p_source in ('server', 'client', 'job') then p_source else 'server' end, left(p_route, 300), left(coalesce(nullif(p_message, ''), 'error'), 1000), left(p_digest, 120), p_org)
  on conflict (fingerprint) do update
    set count = public.app_errors.count + 1, last_seen = now(), resolved = false,
        digest = coalesce(excluded.digest, public.app_errors.digest);
$$;
revoke all on function public.record_app_error(text, text, text, text, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ saved views ----
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  entity text not null check (entity in ('contacts', 'companies', 'deals', 'tasks', 'conversations')),
  name text not null check (char_length(name) between 1 and 60),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 4000),
  shared boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists saved_views_lookup on public.saved_views (organization_id, entity, user_id);
alter table public.saved_views enable row level security;
drop policy if exists saved_views_read on public.saved_views;
create policy saved_views_read on public.saved_views for select to authenticated
  using (public.is_org_member(organization_id) and (user_id = auth.uid() or shared));
drop policy if exists saved_views_insert on public.saved_views;
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (public.is_org_member(organization_id) and user_id = auth.uid());
drop policy if exists saved_views_update on public.saved_views;
create policy saved_views_update on public.saved_views for update to authenticated
  using (public.is_org_member(organization_id) and user_id = auth.uid())
  with check (public.is_org_member(organization_id) and user_id = auth.uid());
drop policy if exists saved_views_delete on public.saved_views;
create policy saved_views_delete on public.saved_views for delete to authenticated
  using (public.is_org_member(organization_id) and user_id = auth.uid());
grant select, insert, update, delete on public.saved_views to authenticated;

-- ------------------------------------------------------------ satisfaction surveys ----
create table if not exists public.survey_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  kind text not null default 'csat' check (kind in ('nps', 'csat', 'ces')),
  delay_minutes int not null default 30 check (delay_minutes between 0 and 10080),
  cooldown_days int not null default 30 check (cooldown_days between 1 and 365),
  question text check (question is null or char_length(question) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.survey_settings enable row level security;
drop policy if exists survey_settings_read on public.survey_settings;
create policy survey_settings_read on public.survey_settings for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists survey_settings_write on public.survey_settings;
create policy survey_settings_write on public.survey_settings for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));
grant select, insert, update on public.survey_settings to authenticated;

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid,
  conversation_id uuid,
  kind text not null check (kind in ('nps', 'csat', 'ces')),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'pending' check (status in ('pending', 'sent', 'answered', 'failed', 'expired')),
  score int,
  comment text check (comment is null or char_length(comment) <= 1000),
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  check (
    score is null
    or (kind = 'nps' and score between 0 and 10)
    or (kind = 'csat' and score between 1 and 5)
    or (kind = 'ces' and score between 1 and 7)
  )
);
create index if not exists survey_responses_org on public.survey_responses (organization_id, created_at desc);
create index if not exists survey_responses_due on public.survey_responses (status, send_after) where status = 'pending';
create index if not exists survey_responses_contact on public.survey_responses (organization_id, contact_id, created_at desc);
alter table public.survey_responses enable row level security;
drop policy if exists survey_responses_read on public.survey_responses;
create policy survey_responses_read on public.survey_responses for select to authenticated
  using (public.has_permission(organization_id, 'analytics.read') or public.has_permission(organization_id, 'inbox.read'));
revoke insert, update, delete on public.survey_responses from anon, authenticated;
grant select on public.survey_responses to authenticated;

-- a conversation was closed → one survey (if enabled, the contact is known and was not asked recently)
create or replace function public.conversations_survey_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
begin
  begin
    if new.status is distinct from 'closed' or old.status = 'closed' or new.contact_id is null then return new; end if;
    select * into s from public.survey_settings where organization_id = new.organization_id and enabled;
    if s.organization_id is null then return new; end if;
    if exists (
      select 1 from public.survey_responses
       where organization_id = new.organization_id and contact_id = new.contact_id
         and created_at > now() - make_interval(days => s.cooldown_days)
    ) then return new; end if;
    insert into public.survey_responses (organization_id, contact_id, conversation_id, kind, send_after)
    values (new.organization_id, new.contact_id, new.id, s.kind, now() + make_interval(mins => s.delay_minutes));
  exception when others then
    -- a survey must never block closing a conversation
    null;
  end;
  return new;
end;
$$;
drop trigger if exists conversations_survey_on_close on public.conversations;
create trigger conversations_survey_on_close after update of status on public.conversations
  for each row execute function public.conversations_survey_on_close();

-- the public answer page (no login): the token is the only key; one answer per survey
create or replace function public.survey_by_token(p_token text)
returns table (kind text, status text, org_name text, question text, locale text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.kind, r.status, o.name, s.question, o.locale
    from public.survey_responses r
    join public.organizations o on o.id = r.organization_id
    left join public.survey_settings s on s.organization_id = r.organization_id
   where r.token = p_token and char_length(p_token) between 16 and 64
   limit 1;
$$;

create or replace function public.answer_survey(p_token text, p_score int, p_comment text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.survey_responses where token = p_token for update;
  if r.id is null then return 'not_found'; end if;
  if r.status = 'answered' then return 'already'; end if;
  if (r.kind = 'nps' and (p_score < 0 or p_score > 10)) or (r.kind = 'csat' and (p_score < 1 or p_score > 5)) or (r.kind = 'ces' and (p_score < 1 or p_score > 7)) then
    return 'invalid';
  end if;
  update public.survey_responses
     set score = p_score, comment = nullif(left(btrim(coalesce(p_comment, '')), 1000), ''), status = 'answered', answered_at = now()
   where id = r.id;
  -- a low score tells the team right away
  if (r.kind = 'nps' and p_score <= 6) or (r.kind = 'csat' and p_score <= 2) or (r.kind = 'ces' and p_score >= 5) then
    insert into public.notifications (organization_id, user_id, kind, title_key, params, link)
    select r.organization_id, m.user_id, 'agents', 'surveys.lowScoreNotification', jsonb_build_object('score', p_score::text, 'kind', upper(r.kind)), '/support'
      from public.organization_members m
     where m.organization_id = r.organization_id and m.role in ('agency_owner', 'owner', 'admin', 'manager', 'support');
  end if;
  return 'ok';
end;
$$;
grant execute on function public.survey_by_token(text) to anon, authenticated;
grant execute on function public.answer_survey(text, int, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.job_runs, public.app_errors, public.saved_views, public.survey_settings, public.survey_responses to service_role';
    execute 'grant execute on function public.start_job_run(text, int), public.finish_job_run(uuid, text, int, text, jsonb), public.record_app_error(text, text, text, text, text, uuid) to service_role';
  end if;
end $$;
