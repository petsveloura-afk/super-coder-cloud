-- ============================================================================
-- SUPER CODER CLOUD — 0005 Platform tables: audit, notifications, flags,
-- API keys, files, integrations (credentials encrypted, never client-readable)
-- ============================================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  entity_type text not null check (char_length(entity_type) <= 40),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- Audit logs are append-only, even for owners.
create or replace function public.audit_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end; $$;
drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Generic row audit trigger for tenant tables.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record := coalesce(new, old);
begin
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    rec.organization_id,
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(to_jsonb(rec) ->> 'id', to_jsonb(rec) ->> 'user_id')::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', (
      select coalesce(jsonb_agg(n.key), '[]'::jsonb)
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
      where n.value is distinct from o.value and n.key not in ('updated_at', 'search')
    )) else '{}'::jsonb end
  );
  return rec;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['contacts', 'companies', 'deals', 'organization_members'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) <= 60),
  title_key text not null,
  params jsonb not null default '{}'::jsonb,
  link text check (link is null or link ~ '^/'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table if not exists public.feature_flags (
  key text not null check (key ~ '^[a-z0-9_.-]{2,60}$'),
  organization_id uuid references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (key, organization_id)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bucket text not null default 'org-files',
  -- Path MUST start with "<organization_id>/" — enforced here and by storage policies.
  path text not null,
  mime_type text not null check (char_length(mime_type) <= 120),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  contact_id uuid,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (path like organization_id::text || '/%'),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id)
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_-]{2,40}$'),
  status public.integration_status not null default 'not_configured',
  config jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider),
  unique (organization_id, id)
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

-- Encrypted (AES-256-GCM, app-side) credentials. No RLS policy grants
-- access to `authenticated`: only the service role (server) can read them.
create table if not exists public.integration_credentials (
  integration_id uuid primary key,
  organization_id uuid not null,
  ciphertext text not null check (ciphertext like 'v1:%'),
  rotated_at timestamptz not null default now(),
  foreign key (organization_id, integration_id) references public.integrations (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Dashboard KPIs — SECURITY INVOKER so RLS applies; returns real counts only.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpis(org uuid, since timestamptz default now() - interval '30 days')
returns table (
  total_contacts bigint,
  new_contacts bigint,
  qualified_contacts bigint,
  customers bigint,
  open_deals bigint,
  open_pipeline_value numeric,
  won_value numeric,
  won_deals bigint,
  lost_deals bigint,
  open_tasks bigint,
  overdue_tasks bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    (select count(*) from contacts c where c.organization_id = org),
    (select count(*) from contacts c where c.organization_id = org and c.created_at >= since),
    (select count(*) from contacts c where c.organization_id = org and c.status = 'qualified'),
    (select count(*) from contacts c where c.organization_id = org and c.status = 'customer'),
    (select count(*) from deals d where d.organization_id = org and d.status = 'open'),
    (select coalesce(sum(value), 0) from deals d where d.organization_id = org and d.status = 'open'),
    (select coalesce(sum(value), 0) from deals d where d.organization_id = org and d.status = 'won' and d.closed_at >= since),
    (select count(*) from deals d where d.organization_id = org and d.status = 'won' and d.closed_at >= since),
    (select count(*) from deals d where d.organization_id = org and d.status = 'lost' and d.closed_at >= since),
    (select count(*) from tasks t where t.organization_id = org and t.status in ('open', 'in_progress')),
    (select count(*) from tasks t where t.organization_id = org and t.status in ('open', 'in_progress') and t.due_at < now());
$$;

-- Daily new contacts series for charts (RLS-respecting).
create or replace function public.contacts_daily(org uuid, days int default 30)
returns table (day date, count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select d::date as day,
         (select count(*) from contacts c
           where c.organization_id = org
             and c.created_at >= d and c.created_at < d + interval '1 day') as count
  from generate_series(
    date_trunc('day', now()) - make_interval(days => least(greatest(days, 1), 366) - 1),
    date_trunc('day', now()),
    interval '1 day'
  ) as d;
$$;
