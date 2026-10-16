-- ============================================================================
-- SUPER CODER CLOUD — 0014 CRM suite (wave 1)
-- Deals/Kanban integrity, CRM analytics, CSV import, duplicate merge, tags.
-- Additive only. Every function is SECURITY INVOKER: RLS stays the final gate,
-- and each function additionally checks the permission it needs.
-- ============================================================================

-- ---------------------------------------------------------------- deals ----
-- Order inside a Kanban column (lower = higher). Optional; ties fall back to updated_at.
alter table public.deals add column if not exists position double precision not null default 0;
create index if not exists deals_org_pipeline_idx on public.deals (organization_id, pipeline_id, status, stage_id, position);
create index if not exists companies_org_created_idx on public.companies (organization_id, created_at desc);
create index if not exists contacts_org_company_idx on public.contacts (organization_id, company_id);
create index if not exists tasks_org_assignee_idx on public.tasks (organization_id, assignee_id, status, due_at);

-- Stage must belong to the deal's pipeline; won/lost stamps closed_at, reopening clears it.
create or replace function public.deals_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.pipeline_stages s
     where s.id = new.stage_id and s.pipeline_id = new.pipeline_id and s.organization_id = new.organization_id
  ) then
    raise exception 'stage_not_in_pipeline' using errcode = '23514';
  end if;
  if new.status in ('won', 'lost') then
    if tg_op = 'INSERT' or old.status is distinct from new.status or new.closed_at is null then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  else
    new.closed_at := null;
    new.lost_reason := null;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_integrity on public.deals;
create trigger deals_integrity before insert or update on public.deals
  for each row execute function public.deals_integrity();

-- --------------------------------------------------------------- tasks -----
create or replace function public.tasks_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.tasks_touch();

-- ----------------------------------------------------------- analytics -----
create or replace function public.crm_analytics(p_org uuid, p_days int default 90)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)));
  result jsonb;
begin
  if not public.has_permission(p_org, 'analytics.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with
  open_by_stage as (
    select s.id, s.name, s.position, p.name as pipeline, p.is_default,
           count(d.id) filter (where d.status = 'open') as deals,
           coalesce(sum(d.value) filter (where d.status = 'open'), 0) as value
      from public.pipeline_stages s
      join public.pipelines p on p.id = s.pipeline_id
      left join public.deals d on d.stage_id = s.id
     where s.organization_id = p_org
     group by s.id, s.name, s.position, p.name, p.is_default
  ),
  closed as (
    select status, count(*) as n, coalesce(sum(value), 0) as v
      from public.deals
     where organization_id = p_org and status in ('won', 'lost') and closed_at >= since
     group by status
  ),
  monthly as (
    select to_char(date_trunc('month', closed_at), 'YYYY-MM') as month,
           coalesce(sum(value), 0) as value, count(*) as deals
      from public.deals
     where organization_id = p_org and status = 'won' and closed_at >= date_trunc('month', now()) - interval '11 months'
     group by 1
  ),
  sources as (
    select source, count(*) as n
      from public.contacts
     where organization_id = p_org and created_at >= since
     group by source
  ),
  owners as (
    select d.owner_id, coalesce(pr.full_name, pr.email, '—') as name,
           count(*) as deals, coalesce(sum(d.value), 0) as value
      from public.deals d
      left join public.profiles pr on pr.id = d.owner_id
     where d.organization_id = p_org and d.status = 'won' and d.closed_at >= since
     group by d.owner_id, pr.full_name, pr.email
     order by value desc
     limit 10
  )
  select jsonb_build_object(
    'days', extract(day from now() - since)::int,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pipeline', pipeline, 'deals', deals, 'value', value)
                                          order by is_default desc, pipeline, position) from open_by_stage), '[]'::jsonb),
    'open_deals', (select count(*) from public.deals where organization_id = p_org and status = 'open'),
    'open_value', (select coalesce(sum(value), 0) from public.deals where organization_id = p_org and status = 'open'),
    'weighted_value', (select coalesce(sum(d.value * s.probability / 100.0), 0)
                         from public.deals d join public.pipeline_stages s on s.id = d.stage_id
                        where d.organization_id = p_org and d.status = 'open'),
    'won', coalesce((select n from closed where status = 'won'), 0),
    'won_value', coalesce((select v from closed where status = 'won'), 0),
    'lost', coalesce((select n from closed where status = 'lost'), 0),
    'lost_value', coalesce((select v from closed where status = 'lost'), 0),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'value', value, 'deals', deals) order by month) from monthly), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'count', n) order by n desc) from sources), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'deals', deals, 'value', value)) from owners), '[]'::jsonb),
    'contacts_new', (select count(*) from public.contacts where organization_id = p_org and created_at >= since),
    'companies', (select count(*) from public.companies where organization_id = p_org),
    'tasks_open', (select count(*) from public.tasks where organization_id = p_org and status in ('open', 'in_progress')),
    'tasks_overdue', (select count(*) from public.tasks where organization_id = p_org and status in ('open', 'in_progress') and due_at < now()),
    'tasks_done', (select count(*) from public.tasks where organization_id = p_org and status = 'done' and updated_at >= since)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.crm_analytics(uuid, int) from public, anon;
grant execute on function public.crm_analytics(uuid, int) to authenticated;

-- ------------------------------------------------------------ CSV import ---
-- p_rows: [{first_name,last_name,email,phone,company_name,job_title,status,source,marketing_consent}]
-- Invalid rows and existing e-mails are skipped (reported), never overwritten.
create or replace function public.import_contacts(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  r jsonb;
  fn text; ln text; em text; ph text; st text; src text;
  inserted int := 0;
  skipped int := 0;
  invalid int := 0;
  idx int := 0;
  errors jsonb := '[]'::jsonb;
  new_id uuid;
begin
  if not public.has_permission(p_org, 'contacts.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'import_too_large' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    fn := nullif(btrim(coalesce(r ->> 'first_name', '')), '');
    ln := left(btrim(coalesce(r ->> 'last_name', '')), 80);
    em := nullif(lower(btrim(coalesce(r ->> 'email', ''))), '');
    ph := nullif(regexp_replace(btrim(coalesce(r ->> 'phone', '')), '[\s\-().]', '', 'g'), '');
    st := coalesce(nullif(r ->> 'status', ''), 'lead');
    src := coalesce(nullif(r ->> 'source', ''), 'import');

    if fn is null and em is not null then
      fn := split_part(em, '@', 1);
    end if;
    if fn is null
       or char_length(fn) > 80
       or (em is null and ph is null)
       or (em is not null and (char_length(em) > 254 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
       or (ph is not null and ph !~ '^\+?[0-9]{7,15}$')
       or st not in ('lead', 'qualified', 'customer', 'inactive')
       or char_length(src) > 40 then
      invalid := invalid + 1;
      if jsonb_array_length(errors) < 50 then errors := errors || jsonb_build_object('row', idx, 'reason', 'invalid'); end if;
      continue;
    end if;

    if em is not null and exists (select 1 from public.contacts c where c.organization_id = p_org and c.email = em::citext) then
      skipped := skipped + 1;
      if jsonb_array_length(errors) < 50 then errors := errors || jsonb_build_object('row', idx, 'reason', 'duplicate'); end if;
      continue;
    end if;

    insert into public.contacts (organization_id, first_name, last_name, email, phone, company_name, job_title, status, source,
                                 marketing_consent, owner_id, created_by)
    values (p_org, fn, ln, em, ph,
            nullif(left(btrim(coalesce(r ->> 'company_name', '')), 160), ''),
            nullif(left(btrim(coalesce(r ->> 'job_title', '')), 120), ''),
            st::public.contact_status, src,
            coalesce((r ->> 'marketing_consent')::boolean, false),
            auth.uid(), auth.uid())
    on conflict do nothing
    returning id into new_id;

    if new_id is null then
      skipped := skipped + 1;
    else
      inserted := inserted + 1;
    end if;
    new_id := null;
  end loop;

  return jsonb_build_object('inserted', inserted, 'skipped', skipped, 'invalid', invalid, 'errors', errors);
end;
$$;

revoke execute on function public.import_contacts(uuid, jsonb) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb) to authenticated;

-- ------------------------------------------------------- duplicate merge ---
create or replace function public.find_duplicate_contacts(p_org uuid, p_contact uuid)
returns table (id uuid, first_name text, last_name text, email text, phone text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.id, c.first_name, c.last_name, c.email::text, c.phone, c.created_at
    from public.contacts c
    join public.contacts me on me.id = p_contact and me.organization_id = p_org
   where c.organization_id = p_org
     and c.id <> me.id
     and (
       (me.phone is not null and c.phone = me.phone)
       or (me.email is not null and c.email = me.email)
       or (lower(c.first_name) = lower(me.first_name) and lower(c.last_name) = lower(me.last_name) and me.last_name <> '')
     )
   order by c.created_at
   limit 20;
$$;

revoke execute on function public.find_duplicate_contacts(uuid, uuid) from public, anon;
grant execute on function public.find_duplicate_contacts(uuid, uuid) to authenticated;

create or replace function public.merge_contacts(p_org uuid, p_keep uuid, p_merge uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  m public.contacts;
begin
  if not (public.has_permission(p_org, 'contacts.write') and public.has_permission(p_org, 'contacts.delete')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_keep = p_merge then
    raise exception 'same_contact' using errcode = '22023';
  end if;
  select * into m from public.contacts where id = p_merge and organization_id = p_org;
  if not found or not exists (select 1 from public.contacts where id = p_keep and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.notes      set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.tasks      set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.deals      set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.activities set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  update public.files      set contact_id = p_keep where organization_id = p_org and contact_id = p_merge;
  insert into public.contact_tags (organization_id, contact_id, tag_id)
    select organization_id, p_keep, tag_id from public.contact_tags where organization_id = p_org and contact_id = p_merge
    on conflict do nothing;

  -- release the unique e-mail before copying it over
  delete from public.contacts where id = p_merge and organization_id = p_org;

  update public.contacts k set
    email        = coalesce(k.email, m.email),
    phone        = coalesce(k.phone, m.phone),
    company_id   = coalesce(k.company_id, m.company_id),
    company_name = coalesce(k.company_name, m.company_name),
    job_title    = coalesce(k.job_title, m.job_title),
    marketing_consent = k.marketing_consent or m.marketing_consent,
    custom_fields = m.custom_fields || k.custom_fields,
    updated_at   = now()
  where k.id = p_keep and k.organization_id = p_org;

  insert into public.activities (organization_id, contact_id, type, payload, actor_id)
  values (p_org, p_keep, 'contact.merged',
          jsonb_build_object('merged_id', p_merge, 'name', btrim(m.first_name || ' ' || m.last_name)), auth.uid());
  return p_keep;
end;
$$;

revoke execute on function public.merge_contacts(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ tags ---
-- Replace a contact's tags by name; unknown names are created (contacts.write).
create or replace function public.set_contact_tags(p_org uuid, p_contact uuid, p_names text[])
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  cleaned text[];
begin
  if not public.has_permission(p_org, 'contacts.write') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where id = p_contact and organization_id = p_org) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct n), '{}') into cleaned
    from (select left(btrim(x), 40) as n from unnest(coalesce(p_names, '{}')) x) s
   where n <> '';
  if cardinality(cleaned) > 30 then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;

  insert into public.tags (organization_id, name)
    select p_org, n from unnest(cleaned) n
    on conflict (organization_id, name) do nothing;

  delete from public.contact_tags ct
   where ct.organization_id = p_org and ct.contact_id = p_contact
     and ct.tag_id not in (select t.id from public.tags t where t.organization_id = p_org and t.name = any (cleaned));

  insert into public.contact_tags (organization_id, contact_id, tag_id)
    select p_org, p_contact, t.id from public.tags t where t.organization_id = p_org and t.name = any (cleaned)
    on conflict do nothing;

  return cardinality(cleaned);
end;
$$;

revoke execute on function public.set_contact_tags(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_contact_tags(uuid, uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
