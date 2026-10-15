-- ============================================================================
-- SUPER CODER CLOUD — 0004 CRM core
-- Every tenant row carries organization_id. Cross-row references use
-- COMPOSITE foreign keys (organization_id, id) so a row can never point at
-- another tenant's record, even if a malicious id is supplied.
-- ============================================================================

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  domain text check (domain is null or char_length(domain) <= 253),
  industry text check (industry is null or char_length(industry) <= 120),
  phone text check (phone is null or char_length(phone) <= 32),
  custom_properties jsonb not null default '{}'::jsonb,
  owner_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists companies_org_name_idx on public.companies (organization_id, lower(name));
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  email extensions.citext check (email is null or char_length(email::text) <= 254),
  phone text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  job_title text check (job_title is null or char_length(job_title) <= 120),
  company_name text check (company_name is null or char_length(company_name) <= 160),
  status public.contact_status not null default 'lead',
  source text not null default 'manual' check (char_length(source) <= 40),
  utm jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  owner_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple',
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(email::text, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(company_name, ''))
  ) stored,
  unique (organization_id, id),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete set null (company_id)
);
create index if not exists contacts_org_created_idx on public.contacts (organization_id, created_at desc);
create index if not exists contacts_org_status_idx on public.contacts (organization_id, status);
create index if not exists contacts_search_idx on public.contacts using gin (search);
-- Duplicate detection: one email per organization
create unique index if not exists contacts_org_email_uniq on public.contacts (organization_id, email) where email is not null;
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create or replace function public.contacts_consent_timestamp()
returns trigger language plpgsql as $$
begin
  if new.marketing_consent and (tg_op = 'INSERT' or not old.marketing_consent) then
    new.marketing_consent_at := now();
  elsif not new.marketing_consent then
    new.marketing_consent_at := null;
  end if;
  return new;
end; $$;
create trigger contacts_consent before insert or update of marketing_consent on public.contacts
  for each row execute function public.contacts_consent_timestamp();

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index if not exists pipelines_one_default on public.pipelines (organization_id) where is_default;
create trigger pipelines_updated_at before update on public.pipelines
  for each row execute function public.set_updated_at();

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  position int not null default 0,
  probability int not null default 0 check (probability between 0 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, pipeline_id) references public.pipelines (organization_id, id) on delete cascade
);
create index if not exists pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null,
  stage_id uuid not null,
  contact_id uuid,
  company_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  value numeric(14, 2) not null default 0 check (value >= 0),
  currency char(3) not null default 'ILS',
  status public.deal_status not null default 'open',
  expected_close_date date,
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  owner_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, pipeline_id) references public.pipelines (organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.pipeline_stages (organization_id, id) on delete restrict,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete set null (company_id)
);
create index if not exists deals_org_stage_idx on public.deals (organization_id, stage_id);
create index if not exists deals_org_status_idx on public.deals (organization_id, status, created_at desc);
create trigger deals_updated_at before update on public.deals
  for each row execute function public.set_updated_at();

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid,
  deal_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  status public.task_status not null default 'open',
  due_at timestamptz,
  assignee_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete cascade
);
create index if not exists tasks_org_due_idx on public.tasks (organization_id, status, due_at);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid,
  deal_id uuid,
  body text not null check (char_length(body) between 1 and 10000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete cascade,
  check (contact_id is not null or deal_id is not null)
);
create index if not exists notes_contact_idx on public.notes (organization_id, contact_id, created_at desc);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid,
  deal_id uuid,
  type text not null check (char_length(type) <= 40),
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, deal_id) references public.deals (organization_id, id) on delete cascade
);
create index if not exists activities_contact_idx on public.activities (organization_id, contact_id, created_at desc);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#477BFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table if not exists public.contact_tags (
  organization_id uuid not null,
  contact_id uuid not null,
  tag_id uuid not null,
  primary key (contact_id, tag_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.tags (organization_id, id) on delete cascade
);

create table if not exists public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity text not null check (entity in ('contact', 'company', 'deal')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label jsonb not null default '{}'::jsonb,
  field_type text not null check (field_type in ('text', 'number', 'date', 'select', 'boolean', 'url')),
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  unique (organization_id, entity, key)
);
