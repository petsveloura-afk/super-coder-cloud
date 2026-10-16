-- ============================================================================
-- SUPER CODER CLOUD — 0016 Automations engine, outbound webhooks, job queue,
-- inbound webhooks and public-API support (wave 2). Additive only.
--
-- Flow:  data change ─trigger─▶ emit_event() ─▶ events (outbox)
--                                   ├─▶ run_automations(): internal actions run
--                                   │   instantly in Postgres (each automation in
--                                   │   its own sub-transaction — a failing rule is
--                                   │   logged, it never breaks the user's save)
--                                   └─▶ jobs: e-mail / webhook / WhatsApp / Telegram /
--                                       SMS / delayed actions, dispatched by the app
--                                       (/api/jobs/dispatch) with retry + dead-letter.
-- Loop guard: nested automation depth ≤ 3.
-- ============================================================================

-- ------------------------------------------------------------- tables ----
create table if not exists public.events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (char_length(type) <= 60),
  entity_type text not null check (char_length(entity_type) <= 40),
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid,
  depth int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists events_org_created_idx on public.events (organization_id, created_at desc);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  enabled boolean not null default true,
  trigger_type text not null check (trigger_type in (
    'contact.created', 'contact.status_changed', 'contact.tagged',
    'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
    'task.completed', 'webhook.inbound',
    'form.submitted', 'message.received', 'appointment.booked', 'ticket.created', 'invoice.paid'
  )),
  trigger_config jsonb not null default '{}'::jsonb check (jsonb_typeof(trigger_config) = 'object'),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 20),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 20),
  inbound_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  run_count int not null default 0,
  last_run_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists automations_org_trigger_idx on public.automations (organization_id, trigger_type) where enabled;

create table if not exists public.automation_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null,
  event_id bigint references public.events (id) on delete set null,
  status text not null check (status in ('success', 'partial', 'failed', 'skipped')),
  steps jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, automation_id) references public.automations (organization_id, id) on delete cascade
);
create unique index if not exists automation_runs_once on public.automation_runs (automation_id, event_id) where event_id is not null;
create index if not exists automation_runs_org_idx on public.automation_runs (organization_id, created_at desc);

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  url text not null check (url ~ '^https://[^\s]+$' and char_length(url) <= 2000),
  description text check (description is null or char_length(description) <= 200),
  events text[] not null check (cardinality(events) between 1 and 30),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  enabled boolean not null default true,
  last_status int,
  last_delivery_at timestamptz,
  failure_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('email', 'webhook', 'http', 'whatsapp', 'telegram', 'sms', 'action')),
  automation_id uuid,
  webhook_id uuid,
  event_id bigint,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'dead', 'canceled')),
  attempts int not null default 0,
  max_attempts int not null default 6 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  response_status int,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id, automation_id) references public.automations (organization_id, id) on delete set null (automation_id),
  foreign key (organization_id, webhook_id) references public.webhooks (organization_id, id) on delete cascade
);
create index if not exists jobs_due_idx on public.jobs (run_after) where status = 'queued';
create index if not exists jobs_org_idx on public.jobs (organization_id, created_at desc);

-- -------------------------------------------------------------- RLS ------
alter table public.events enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.webhooks enable row level security;
alter table public.jobs enable row level security;

create policy events_select on public.events for select to authenticated
  using (public.has_permission(organization_id, 'automations.manage') or public.has_permission(organization_id, 'api.manage'));
create policy automation_runs_select on public.automation_runs for select to authenticated
  using (public.has_permission(organization_id, 'automations.manage'));
create policy jobs_select on public.jobs for select to authenticated
  using (public.has_permission(organization_id, 'automations.manage') or public.has_permission(organization_id, 'api.manage'));

create policy automations_select on public.automations for select to authenticated using (public.has_permission(organization_id, 'automations.manage'));
create policy automations_insert on public.automations for insert to authenticated with check (public.has_permission(organization_id, 'automations.manage'));
create policy automations_update on public.automations for update to authenticated
  using (public.has_permission(organization_id, 'automations.manage')) with check (public.has_permission(organization_id, 'automations.manage'));
create policy automations_delete on public.automations for delete to authenticated using (public.has_permission(organization_id, 'automations.manage'));

create policy webhooks_select on public.webhooks for select to authenticated using (public.has_permission(organization_id, 'api.manage'));
create policy webhooks_insert on public.webhooks for insert to authenticated with check (public.has_permission(organization_id, 'api.manage'));
create policy webhooks_update on public.webhooks for update to authenticated
  using (public.has_permission(organization_id, 'api.manage')) with check (public.has_permission(organization_id, 'api.manage'));
create policy webhooks_delete on public.webhooks for delete to authenticated using (public.has_permission(organization_id, 'api.manage'));

-- api_keys: managed with api.manage from now on (settings.manage kept for compatibility).
create policy api_keys_select_api on public.api_keys for select to authenticated using (public.has_permission(organization_id, 'api.manage'));
create policy api_keys_insert_api on public.api_keys for insert to authenticated with check (public.has_permission(organization_id, 'api.manage'));
create policy api_keys_update_api on public.api_keys for update to authenticated
  using (public.has_permission(organization_id, 'api.manage')) with check (public.has_permission(organization_id, 'api.manage'));

-- events / runs / jobs are written only by SECURITY DEFINER functions and the service role.
revoke insert, update, delete on public.events, public.automation_runs, public.jobs from authenticated, anon;
grant select on public.events, public.automation_runs, public.jobs, public.automations, public.webhooks to authenticated;
grant insert, update, delete on public.automations, public.webhooks to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.events, public.automations, public.automation_runs, public.webhooks, public.jobs to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

-- ------------------------------------------------------------ helpers ----
-- {{contact.first_name}} style placeholders, resolved from the event context.
create or replace function public.render_template(p_text text, p_ctx jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  out_text text := coalesce(p_text, '');
  m text[];
  val text;
  guard int := 0;
begin
  loop
    m := regexp_match(out_text, '\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}');
    exit when m is null or guard > 50;
    guard := guard + 1;
    val := coalesce(p_ctx #>> string_to_array(m[1], '.'), '');
    out_text := regexp_replace(out_text, '\{\{\s*' || replace(m[1], '.', '\.') || '\s*\}\}', replace(val, '\', '\\'), 'g');
  end loop;
  return out_text;
end;
$$;

create or replace function public.eval_condition(p_ctx jsonb, p_cond jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  field text := p_cond ->> 'field';
  op text := coalesce(p_cond ->> 'op', 'eq');
  expected text := p_cond ->> 'value';
  actual text;
begin
  if field is null or field !~ '^[a-z_]+(\.[a-z_]+)*$' then
    return false;
  end if;
  actual := p_ctx #>> string_to_array(field, '.');
  return case op
    when 'eq' then lower(coalesce(actual, '')) = lower(coalesce(expected, ''))
    when 'neq' then lower(coalesce(actual, '')) <> lower(coalesce(expected, ''))
    when 'contains' then position(lower(coalesce(expected, '')) in lower(coalesce(actual, ''))) > 0
    when 'not_contains' then position(lower(coalesce(expected, '')) in lower(coalesce(actual, ''))) = 0
    when 'empty' then coalesce(actual, '') = ''
    when 'not_empty' then coalesce(actual, '') <> ''
    when 'gt' then case when actual ~ '^-?[0-9.]+$' and expected ~ '^-?[0-9.]+$' then actual::numeric > expected::numeric else false end
    when 'lt' then case when actual ~ '^-?[0-9.]+$' and expected ~ '^-?[0-9.]+$' then actual::numeric < expected::numeric else false end
    else false
  end;
end;
$$;

-- Context available to conditions / templates: {event, payload, contact, deal, org}
create or replace function public.automation_context(p_event public.events)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  ctx jsonb;
  cid uuid;
  did uuid;
begin
  ctx := jsonb_build_object(
    'event', jsonb_build_object('type', p_event.type, 'id', p_event.id, 'at', p_event.created_at),
    'payload', p_event.payload,
    'org', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = p_event.organization_id)
  );
  if p_event.entity_type = 'contact' then
    cid := p_event.entity_id;
  elsif p_event.entity_type = 'deal' then
    did := p_event.entity_id;
  else
    cid := nullif(p_event.payload ->> 'contact_id', '')::uuid;
    did := nullif(p_event.payload ->> 'deal_id', '')::uuid;
  end if;
  if did is not null then
    ctx := jsonb_set(ctx, '{deal}', coalesce((select to_jsonb(x) from public.deals x where x.id = did and x.organization_id = p_event.organization_id), 'null'::jsonb));
    if cid is null then
      cid := nullif(ctx #>> '{deal,contact_id}', '')::uuid;
    end if;
  end if;
  if cid is not null then
    ctx := jsonb_set(ctx, '{contact}', coalesce((select to_jsonb(c) - 'search' from public.contacts c where c.id = cid and c.organization_id = p_event.organization_id), 'null'::jsonb));
  end if;
  return ctx;
end;
$$;

-- ----------------------------------------------------- action executor ----
create or replace function public.execute_automation_action(p_org uuid, p_automation uuid, p_event bigint, p_action jsonb, p_ctx jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  typ text := p_action ->> 'type';
  cfg jsonb := coalesce(p_action -> 'config', '{}'::jsonb);
  cid uuid := nullif(p_ctx #>> '{contact,id}', '')::uuid;
  did uuid := nullif(p_ctx #>> '{deal,id}', '')::uuid;
  delay_min int := coalesce(nullif(cfg ->> 'delay_minutes', '')::int, 0);
  v_tag uuid;
  v_user uuid;
  v_text text;
  v_to text;
  n int := 0;
begin
  if delay_min > 0 and coalesce(p_action ->> '_delayed', '') <> 'true' then
    insert into public.jobs (organization_id, kind, automation_id, event_id, payload, run_after)
    values (p_org, 'action', p_automation, p_event,
            jsonb_build_object('action', p_action || '{"_delayed":"true"}'::jsonb, 'ctx', p_ctx),
            now() + make_interval(mins => least(delay_min, 525600)));
    return jsonb_build_object('type', typ, 'status', 'scheduled', 'detail', delay_min || ' min');
  end if;

  case typ
  when 'create_task' then
    v_user := case cfg ->> 'assignee'
                when 'owner' then coalesce(nullif(p_ctx #>> '{deal,owner_id}', '')::uuid, nullif(p_ctx #>> '{contact,owner_id}', '')::uuid)
                else nullif(cfg ->> 'assignee', '')::uuid
              end;
    if v_user is not null and not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = v_user) then
      v_user := null;
    end if;
    insert into public.tasks (organization_id, contact_id, deal_id, title, description, due_at, assignee_id)
    values (p_org, cid, did,
            left(coalesce(nullif(btrim(public.render_template(cfg ->> 'title', p_ctx)), ''), 'Follow up'), 200),
            nullif(left(public.render_template(cfg ->> 'description', p_ctx), 5000), ''),
            case when coalesce(cfg ->> 'due_in_days', '') ~ '^[0-9]{1,4}$' then now() + make_interval(days => (cfg ->> 'due_in_days')::int) end,
            v_user);

  when 'add_tag', 'remove_tag' then
    if cid is null then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_contact'); end if;
    v_text := left(btrim(coalesce(cfg ->> 'tag', '')), 40);
    if v_text = '' then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_tag'); end if;
    if typ = 'add_tag' then
      insert into public.tags (organization_id, name) values (p_org, v_text) on conflict (organization_id, name) do nothing;
      select id into v_tag from public.tags where organization_id = p_org and name = v_text;
      insert into public.contact_tags (organization_id, contact_id, tag_id) values (p_org, cid, v_tag) on conflict do nothing;
    else
      delete from public.contact_tags ct using public.tags t
       where ct.organization_id = p_org and ct.contact_id = cid and t.id = ct.tag_id and t.name = v_text;
    end if;

  when 'set_contact_status' then
    if cid is null then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_contact'); end if;
    update public.contacts set status = (cfg ->> 'status')::public.contact_status, updated_at = now()
     where id = cid and organization_id = p_org and status is distinct from (cfg ->> 'status')::public.contact_status;

  when 'set_deal_stage' then
    if did is null then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_deal'); end if;
    update public.deals set stage_id = (cfg ->> 'stage_id')::uuid where id = did and organization_id = p_org;

  when 'assign_owner' then
    v_user := nullif(cfg ->> 'user_id', '')::uuid;
    if v_user is null or not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = v_user) then
      return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'not_a_member');
    end if;
    if did is not null then update public.deals set owner_id = v_user where id = did and organization_id = p_org; end if;
    if cid is not null then update public.contacts set owner_id = v_user, updated_at = now() where id = cid and organization_id = p_org; end if;

  when 'add_note' then
    if cid is null and did is null then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_record'); end if;
    v_text := left(btrim(public.render_template(cfg ->> 'body', p_ctx)), 10000);
    if v_text = '' then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'empty'); end if;
    insert into public.notes (organization_id, contact_id, deal_id, body) values (p_org, cid, did, v_text);

  when 'notify' then
    v_text := left(public.render_template(coalesce(cfg ->> 'text', ''), p_ctx), 300);
    insert into public.notifications (organization_id, user_id, kind, title_key, params)
    select p_org, m.user_id, 'automation', 'automations.notification', jsonb_build_object('text', v_text)
      from public.organization_members m
     where m.organization_id = p_org
       and case coalesce(cfg ->> 'to', 'admins')
             when 'admins' then m.role in ('agency_owner', 'owner', 'admin')
             when 'owner' then m.user_id = coalesce(nullif(p_ctx #>> '{deal,owner_id}', '')::uuid, nullif(p_ctx #>> '{contact,owner_id}', '')::uuid)
             when 'all' then true
             else m.user_id::text = cfg ->> 'to'
           end;
    get diagnostics n = row_count;
    return jsonb_build_object('type', typ, 'status', 'ok', 'detail', n || ' recipients');

  when 'send_email' then
    v_to := case coalesce(cfg ->> 'to', 'contact') when 'contact' then p_ctx #>> '{contact,email}' else cfg ->> 'to' end;
    if v_to is null or v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_email');
    end if;
    if coalesce(cfg ->> 'to', 'contact') = 'contact' and coalesce((cfg ->> 'marketing')::boolean, false)
       and not coalesce((p_ctx #>> '{contact,marketing_consent}')::boolean, false) then
      return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_consent');
    end if;
    insert into public.jobs (organization_id, kind, automation_id, event_id, payload)
    values (p_org, 'email', p_automation, p_event, jsonb_build_object(
      'to', v_to,
      'subject', left(public.render_template(coalesce(cfg ->> 'subject', ''), p_ctx), 200),
      'text', left(public.render_template(coalesce(cfg ->> 'body', ''), p_ctx), 20000),
      'contact_id', cid));

  when 'send_webhook' then
    v_to := cfg ->> 'url';
    if v_to is null or v_to !~ '^https://[^\s]+$' then
      return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'bad_url');
    end if;
    insert into public.jobs (organization_id, kind, automation_id, event_id, payload)
    values (p_org, 'http', p_automation, p_event, jsonb_build_object('url', v_to, 'body', jsonb_build_object(
      'event', p_ctx -> 'event', 'contact', p_ctx -> 'contact', 'deal', p_ctx -> 'deal', 'payload', p_ctx -> 'payload')));

  when 'send_whatsapp', 'send_telegram', 'send_sms' then
    if cid is null then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'no_contact'); end if;
    v_text := left(public.render_template(coalesce(cfg ->> 'text', ''), p_ctx), 4000);
    if btrim(v_text) = '' then return jsonb_build_object('type', typ, 'status', 'skipped', 'detail', 'empty'); end if;
    insert into public.jobs (organization_id, kind, automation_id, event_id, payload)
    values (p_org, replace(typ, 'send_', ''), p_automation, p_event, jsonb_build_object('contact_id', cid, 'text', v_text));

  else
    raise exception 'unknown_action:%', typ using errcode = '22023';
  end case;

  return jsonb_build_object('type', typ, 'status', 'ok');
end;
$$;

-- ------------------------------------------------------------ engine ----
create or replace function public.run_automations(p_event public.events)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.automations;
  ctx jsonb;
  cond jsonb;
  act jsonb;
  step jsonb;
  steps jsonb;
  failed int;
  passed boolean;
  ran int := 0;
begin
  for a in
    select * from public.automations
     where organization_id = p_event.organization_id and enabled and trigger_type = p_event.type
     order by created_at
  loop
    if a.trigger_type = 'webhook.inbound' and p_event.payload ->> 'automation_id' is distinct from a.id::text then
      continue;
    end if;
    if exists (
      select 1 from jsonb_each_text(a.trigger_config) kv
       where kv.value <> '' and coalesce(p_event.payload ->> kv.key, '') <> kv.value
    ) then
      continue;
    end if;
    if ctx is null then
      ctx := public.automation_context(p_event);
    end if;

    passed := true;
    for cond in select * from jsonb_array_elements(a.conditions) loop
      if not public.eval_condition(ctx, cond) then
        passed := false;
        exit;
      end if;
    end loop;
    if not passed then
      insert into public.automation_runs (organization_id, automation_id, event_id, status, steps)
      values (a.organization_id, a.id, p_event.id, 'skipped', '[]'::jsonb)
      on conflict do nothing;
      continue;
    end if;

    steps := '[]'::jsonb;
    failed := 0;
    for act in select * from jsonb_array_elements(a.actions) loop
      begin
        step := public.execute_automation_action(a.organization_id, a.id, p_event.id, act, ctx);
      exception when others then
        failed := failed + 1;
        step := jsonb_build_object('type', act ->> 'type', 'status', 'error', 'detail', left(sqlerrm, 300));
      end;
      steps := steps || jsonb_build_array(step);
    end loop;

    insert into public.automation_runs (organization_id, automation_id, event_id, status, steps, error)
    values (a.organization_id, a.id, p_event.id,
            case when failed = 0 then 'success' when failed = jsonb_array_length(a.actions) then 'failed' else 'partial' end,
            steps,
            case when failed > 0 then (select string_agg(s ->> 'detail', '; ') from jsonb_array_elements(steps) s where s ->> 'status' = 'error') end)
    on conflict do nothing;
    update public.automations set run_count = run_count + 1, last_run_at = now() where id = a.id;
    ran := ran + 1;
  end loop;
  return ran;
end;
$$;

create or replace function public.emit_event(p_org uuid, p_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  depth int := coalesce(nullif(current_setting('scc.automation_depth', true), ''), '0')::int;
  e public.events;
begin
  insert into public.events (organization_id, type, entity_type, entity_id, payload, actor_id, depth)
  values (p_org, p_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), auth.uid(), depth)
  returning * into e;

  -- outbound webhook subscriptions
  insert into public.jobs (organization_id, kind, webhook_id, event_id, payload)
  select e.organization_id, 'webhook', w.id, e.id, jsonb_build_object(
           'id', e.id, 'type', e.type, 'created_at', e.created_at,
           'entity_type', e.entity_type, 'entity_id', e.entity_id, 'data', e.payload)
    from public.webhooks w
   where w.organization_id = p_org and w.enabled and (p_type = any (w.events) or '*' = any (w.events));

  if depth < 3 then
    perform set_config('scc.automation_depth', (depth + 1)::text, true);
    begin
      perform public.run_automations(e);
    exception when others then
      raise warning 'automation engine error (event %): %', e.id, sqlerrm;
    end;
    perform set_config('scc.automation_depth', depth::text, true);
  end if;
  return e.id;
end;
$$;

revoke execute on function public.emit_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.run_automations(public.events) from public, anon, authenticated;
revoke execute on function public.execute_automation_action(uuid, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.automation_context(public.events) from public, anon, authenticated;

-- ---------------------------------------------------- change triggers ----
create or replace function public.contacts_emit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event(new.organization_id, 'contact.created', 'contact', new.id,
      jsonb_build_object('source', new.source, 'status', new.status, 'record', to_jsonb(new) - 'search'));
  elsif new.status is distinct from old.status then
    perform public.emit_event(new.organization_id, 'contact.status_changed', 'contact', new.id,
      jsonb_build_object('from', old.status, 'to', new.status, 'record', to_jsonb(new) - 'search'));
  end if;
  return null;
end;
$$;
drop trigger if exists contacts_emit on public.contacts;
create trigger contacts_emit after insert or update of status on public.contacts
  for each row execute function public.contacts_emit();

create or replace function public.deals_emit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_event(new.organization_id, 'deal.created', 'deal', new.id,
      jsonb_build_object('pipeline_id', new.pipeline_id, 'stage_id', new.stage_id, 'contact_id', new.contact_id, 'record', to_jsonb(new)));
    return null;
  end if;
  if new.stage_id is distinct from old.stage_id then
    perform public.emit_event(new.organization_id, 'deal.stage_changed', 'deal', new.id,
      jsonb_build_object('pipeline_id', new.pipeline_id, 'from_stage_id', old.stage_id, 'stage_id', new.stage_id, 'contact_id', new.contact_id, 'record', to_jsonb(new)));
  end if;
  if new.status is distinct from old.status and new.status in ('won', 'lost') then
    perform public.emit_event(new.organization_id, 'deal.' || new.status, 'deal', new.id,
      jsonb_build_object('pipeline_id', new.pipeline_id, 'stage_id', new.stage_id, 'contact_id', new.contact_id, 'record', to_jsonb(new)));
  end if;
  return null;
end;
$$;
drop trigger if exists deals_emit on public.deals;
create trigger deals_emit after insert or update of stage_id, status on public.deals
  for each row execute function public.deals_emit();

create or replace function public.tasks_emit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public.emit_event(new.organization_id, 'task.completed', 'task', new.id,
      jsonb_build_object('contact_id', new.contact_id, 'deal_id', new.deal_id, 'record', to_jsonb(new)));
  end if;
  return null;
end;
$$;
drop trigger if exists tasks_emit on public.tasks;
create trigger tasks_emit after update of status on public.tasks
  for each row execute function public.tasks_emit();

create or replace function public.contact_tags_emit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select name into v_name from public.tags where id = new.tag_id;
  perform public.emit_event(new.organization_id, 'contact.tagged', 'contact', new.contact_id,
    jsonb_build_object('tag', v_name, 'tag_id', new.tag_id, 'contact_id', new.contact_id));
  return null;
end;
$$;
drop trigger if exists contact_tags_emit on public.contact_tags;
create trigger contact_tags_emit after insert on public.contact_tags
  for each row execute function public.contact_tags_emit();

-- ------------------------------------------------- inbound webhooks ----
create or replace function public.ingest_inbound_webhook(p_token text, p_body jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  a public.automations;
  em text;
  ph text;
  fn text;
  cid uuid;
  c int;
  ev bigint;
  body jsonb := case when jsonb_typeof(p_body) = 'object' then p_body else jsonb_build_object('value', p_body) end;
begin
  select * into a from public.automations where inbound_token = p_token and trigger_type = 'webhook.inbound';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not a.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  insert into public.rate_limits as r (bucket, window_start, count)
  values ('hook:' || a.id, date_trunc('minute', now()), 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning count into c;
  if c > 120 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if pg_column_size(body) > 32768 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;

  em := nullif(lower(btrim(coalesce(body ->> 'email', ''))), '');
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then em := null; end if;
  ph := nullif(regexp_replace(btrim(coalesce(body ->> 'phone', '')), '[\s\-().]', '', 'g'), '');
  if ph is not null and ph !~ '^\+?[0-9]{7,15}$' then ph := null; end if;

  if em is not null or ph is not null then
    select id into cid from public.contacts
     where organization_id = a.organization_id
       and ((em is not null and email = em::citext) or (ph is not null and phone = ph))
     order by created_at limit 1;
    if cid is null then
      fn := left(coalesce(nullif(btrim(body ->> 'first_name'), ''), nullif(btrim(body ->> 'name'), ''), split_part(coalesce(em, ''), '@', 1), ph), 80);
      begin
        insert into public.contacts (organization_id, first_name, last_name, email, phone, company_name, source, marketing_consent)
        values (a.organization_id, fn, left(coalesce(body ->> 'last_name', ''), 80), em, ph,
                nullif(left(coalesce(body ->> 'company', body ->> 'company_name', ''), 160), ''),
                'webhook', coalesce((body ->> 'marketing_consent')::boolean, false))
        returning id into cid;
      exception when others then
        cid := null; -- plan limit or invalid data: the event is still recorded
      end;
    end if;
  end if;

  ev := public.emit_event(a.organization_id, 'webhook.inbound', case when cid is null then 'webhook' else 'contact' end, cid,
    jsonb_build_object('automation_id', a.id, 'contact_id', cid, 'body', body));
  return jsonb_build_object('ok', true, 'contact_id', cid, 'event_id', ev);
end;
$$;
revoke execute on function public.ingest_inbound_webhook(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------- job queue ----
create or replace function public.claim_jobs(p_limit int default 25)
returns setof public.jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- a crashed dispatcher leaves jobs "running": give them back after 10 minutes
  update public.jobs set status = 'queued', locked_at = null
   where status = 'running' and locked_at < now() - interval '10 minutes';
  return query
  update public.jobs j set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from public.jobs
      where status = 'queued' and run_after <= now()
      order by run_after
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning j.*;
end;
$$;

create or replace function public.complete_job(p_id bigint, p_ok boolean, p_status int default null, p_error text default null, p_permanent boolean default false)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.jobs;
  new_status text;
begin
  select * into j from public.jobs where id = p_id for update;
  if not found then
    return 'missing';
  end if;
  if p_ok then
    new_status := 'done';
    update public.jobs set status = 'done', finished_at = now(), response_status = p_status, last_error = null where id = p_id;
  elsif p_permanent or j.attempts >= j.max_attempts then
    new_status := 'dead';
    update public.jobs set status = 'dead', finished_at = now(), response_status = p_status, last_error = left(p_error, 1000) where id = p_id;
  else
    new_status := 'queued';
    update public.jobs
       set status = 'queued', locked_at = null, response_status = p_status, last_error = left(p_error, 1000),
           run_after = now() + least(interval '6 hours', make_interval(mins => power(2, greatest(j.attempts, 1))::int))
     where id = p_id;
  end if;
  if j.webhook_id is not null then
    update public.webhooks
       set last_status = p_status, last_delivery_at = now(),
           failure_count = case when p_ok then 0 else failure_count + 1 end,
           enabled = case when not p_ok and failure_count + 1 >= 50 then false else enabled end
     where id = j.webhook_id;
  end if;
  return new_status;
end;
$$;

-- Executes a delayed automation action (kind = 'action').
create or replace function public.run_delayed_action(p_job bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j public.jobs;
  step jsonb;
begin
  select * into j from public.jobs where id = p_job and kind = 'action';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if j.automation_id is null or not exists (select 1 from public.automations where id = j.automation_id and enabled) then
    return jsonb_build_object('status', 'skipped', 'detail', 'automation_disabled');
  end if;
  perform set_config('scc.automation_depth', '1', true);
  step := public.execute_automation_action(j.organization_id, j.automation_id, j.event_id, j.payload -> 'action', j.payload -> 'ctx');
  return step;
end;
$$;

-- --------------------------------------------- public API (service role) --
create or replace function public.api_key_lookup(p_hash text)
returns table (key_id uuid, organization_id uuid, scopes text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.api_keys k
     set last_used_at = now()
   where k.key_hash = p_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
  returning k.id, k.organization_id, k.scopes;
end;
$$;

create or replace function public.hit_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws timestamptz;
  c int;
begin
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (bucket, window_start, count)
  values (left(p_bucket, 120), ws, 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning count into c;
  return c <= p_limit;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ingest_inbound_webhook(text, jsonb)',
    'public.claim_jobs(int)',
    'public.complete_job(bigint, boolean, int, text, boolean)',
    'public.run_delayed_action(bigint)',
    'public.api_key_lookup(text)',
    'public.hit_rate_limit(text, int, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- Test / UI helper: run one automation against a synthetic event (managers only).
create or replace function public.test_automation(p_org uuid, p_automation uuid, p_contact uuid default null, p_deal uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.automations;
  e public.events;
  ctx jsonb;
  act jsonb;
  steps jsonb := '[]'::jsonb;
  step jsonb;
begin
  if not public.has_permission(p_org, 'automations.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into a from public.automations where id = p_automation and organization_id = p_org;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.events (organization_id, type, entity_type, entity_id, payload, actor_id, depth)
  values (p_org, a.trigger_type, case when p_deal is not null then 'deal' when p_contact is not null then 'contact' else 'test' end,
          coalesce(p_deal, p_contact), jsonb_build_object('test', true, 'contact_id', p_contact, 'deal_id', p_deal), auth.uid(), 0)
  returning * into e;
  ctx := public.automation_context(e);
  perform set_config('scc.automation_depth', '1', true);
  for act in select * from jsonb_array_elements(a.actions) loop
    begin
      step := public.execute_automation_action(p_org, a.id, e.id, act, ctx);
    exception when others then
      step := jsonb_build_object('type', act ->> 'type', 'status', 'error', 'detail', left(sqlerrm, 300));
    end;
    steps := steps || jsonb_build_array(step);
  end loop;
  insert into public.automation_runs (organization_id, automation_id, event_id, status, steps)
  values (p_org, a.id, e.id,
          case when exists (select 1 from jsonb_array_elements(steps) s where s ->> 'status' = 'error') then 'partial' else 'success' end, steps);
  return jsonb_build_object('event_id', e.id, 'steps', steps);
end;
$$;
revoke execute on function public.test_automation(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.test_automation(uuid, uuid, uuid, uuid) to authenticated;

-- --------------------------------------------- maintenance (extended) ----
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv int;
  notif int;
  rl int;
  pending int;
  ev int;
  runs int;
  jb int;
begin
  delete from public.invitations where accepted_at is null and expires_at < now() - interval '30 days';
  get diagnostics inv = row_count;
  delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
  get diagnostics notif = row_count;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics rl = row_count;
  update public.ai_usage set status = 'error', credits = 0 where status = 'pending' and created_at < now() - interval '1 hour';
  get diagnostics pending = row_count;
  -- v4: automation history and finished jobs
  delete from public.automation_runs where created_at < now() - interval '60 days';
  get diagnostics runs = row_count;
  delete from public.jobs where status in ('done', 'canceled') and finished_at < now() - interval '30 days';
  get diagnostics jb = row_count;
  delete from public.events e where e.created_at < now() - interval '60 days'
     and not exists (select 1 from public.jobs j where j.event_id = e.id and j.status in ('queued', 'running'));
  get diagnostics ev = row_count;
  return jsonb_build_object(
    'invitations_purged', inv,
    'notifications_purged', notif,
    'rate_limit_rows_purged', rl,
    'ai_pending_released', pending,
    'automation_runs_purged', runs,
    'jobs_purged', jb,
    'events_purged', ev,
    'ran_at', now()
  );
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.run_maintenance() to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
