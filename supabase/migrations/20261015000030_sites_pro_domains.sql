-- =============================================================================
-- Wave 13 — professional websites: templates, legal pages, settings, custom
-- domains (connect your own or buy one through the platform), plan gating.
--
--  * sites.settings / sites.pages      business details + legal pages (privacy,
--                                       terms, accessibility statement, cookies)
--  * sites.custom_domain                a domain that serves the site (host routing)
--  * plans: features site_pro_templates / site_ai_editor / site_custom_domain
--    (paid plans) and the limit sites_published (free 1, pro 5, business 25).
--  * domain_orders                      domains bought through the platform (paid
--                                       by card, registered on Vercel, commission)
--  * get_public_site_v2 / site_slug_for_host   public read paths
--  * api_access / audit_log            plan checks used by the app (has_feature)
-- Additive only.
-- =============================================================================

alter table public.sites add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.sites add column if not exists pages jsonb not null default '{}'::jsonb;
alter table public.sites add column if not exists custom_domain text;
alter table public.sites add column if not exists domain_status text;
alter table public.sites add column if not exists domain_verification jsonb;
alter table public.sites add column if not exists domain_added_at timestamptz;

do $$ begin
  alter table public.sites add constraint sites_settings_object check (jsonb_typeof(settings) = 'object');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sites add constraint sites_pages_object check (jsonb_typeof(pages) = 'object' and pg_column_size(pages) < 200000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sites add constraint sites_custom_domain_format
    check (custom_domain is null or custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sites add constraint sites_domain_status_check
    check (domain_status is null or domain_status in ('pending', 'active', 'error'));
exception when duplicate_object then null; end $$;
create unique index if not exists sites_custom_domain_once on public.sites (custom_domain) where custom_domain is not null;

-- ------------------------------------------------------------------ plans ----
update public.plans set features = array_append(features, 'site_pro_templates')
 where key in ('pro', 'business', 'enterprise') and not ('site_pro_templates' = any (features));
update public.plans set features = array_append(features, 'site_ai_editor')
 where key in ('pro', 'business', 'enterprise') and not ('site_ai_editor' = any (features));
update public.plans set features = array_append(features, 'site_custom_domain')
 where key in ('pro', 'business', 'enterprise') and not ('site_custom_domain' = any (features));
update public.plans set limits = limits || '{"sites_published": 1}'::jsonb where key = 'free' and not (limits ? 'sites_published');
update public.plans set limits = limits || '{"sites_published": 5}'::jsonb where key = 'pro' and not (limits ? 'sites_published');
update public.plans set limits = limits || '{"sites_published": 25}'::jsonb where key = 'business' and not (limits ? 'sites_published');
update public.plans set limits = limits || '{"sites_published": null}'::jsonb where key = 'enterprise' and not (limits ? 'sites_published');

-- does the organization's plan include a feature?
create or replace function public.has_feature(p_org uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select p_feature = any (p.features) from public.organizations o join public.plans p on p.key = o.plan where o.id = p_org), false);
$$;
revoke all on function public.has_feature(uuid, text) from public, anon;
grant execute on function public.has_feature(uuid, text) to authenticated, service_role;

-- published sites per plan (only when a site BECOMES published — existing ones stay)
create or replace function public.enforce_sites_published()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  c bigint;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return new; end if;
  lim := public.plan_limit(new.organization_id, 'sites_published');
  if lim is null then return new; end if;
  select count(*) into c from public.sites where organization_id = new.organization_id and status = 'published' and id <> new.id;
  if c >= lim then
    raise exception 'plan_limit:sites_published' using errcode = 'P0001', hint = 'upgrade';
  end if;
  return new;
end;
$$;
drop trigger if exists sites_published_limit on public.sites;
create trigger sites_published_limit before insert or update of status on public.sites
  for each row execute function public.enforce_sites_published();

-- custom domains are a paid feature and are changed only by the server (service role)
create or replace function public.guard_site_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and (
       (tg_op = 'INSERT' and new.custom_domain is not null)
       or (tg_op = 'UPDATE' and (new.custom_domain is distinct from old.custom_domain
                                 or new.domain_status is distinct from old.domain_status
                                 or new.domain_verification is distinct from old.domain_verification))) then
    raise exception 'protected site column' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists sites_domain_guard on public.sites;
create trigger sites_domain_guard before insert or update on public.sites
  for each row execute function public.guard_site_domain();

-- ------------------------------------------------------------- public reads ----
create or replace function public.get_public_site_v2(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'name', s.name, 'slug', s.slug, 'theme', s.theme, 'seo', s.seo, 'blocks', s.blocks,
    'settings', s.settings, 'pages', s.pages, 'custom_domain', case when s.domain_status = 'active' then s.custom_domain end,
    'org', o.name, 'org_slug', o.slug,
    'branding', not coalesce('white_label' = any (p.features), false))
  from public.sites s
  join public.organizations o on o.id = s.organization_id
  left join public.plans p on p.key = o.plan
  where s.slug = p_slug and s.status = 'published';
$$;

-- (re)created with the site language; safe to drop: it is new in this wave
drop function if exists public.site_slug_for_host(text);
create or replace function public.site_slug_for_host(p_host text)
returns table (slug text, lang text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.slug, coalesce(nullif(s.settings ->> 'lang', ''), 'he') from public.sites s
   where s.status = 'published' and s.domain_status = 'active'
     and s.custom_domain in (lower(btrim(p_host)), regexp_replace(lower(btrim(p_host)), '^www\.', ''))
   limit 1;
$$;
revoke all on function public.get_public_site_v2(text) from public;
revoke all on function public.site_slug_for_host(text) from public;
grant execute on function public.get_public_site_v2(text) to anon, authenticated, service_role;
grant execute on function public.site_slug_for_host(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------- domain orders ----
create table if not exists public.domain_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  domain text not null check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'),
  years int not null default 1 check (years between 1 and 10),
  cost numeric(10, 2) not null check (cost > 0),           -- what the registrar charges (USD)
  price numeric(10, 2) not null check (price >= cost),     -- what the customer pays (cost + commission)
  currency text not null default 'USD',
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'registering', 'active', 'failed', 'canceled')),
  provider_order_id text,                                  -- PayPal order
  registrar_order_id text,                                 -- Vercel order
  contact jsonb,                                           -- registrant details, cleared after registration
  error text check (error is null or char_length(error) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists domain_orders_org on public.domain_orders (organization_id, created_at desc);
create unique index if not exists domain_orders_provider_once on public.domain_orders (provider_order_id) where provider_order_id is not null;
alter table public.domain_orders enable row level security;
drop policy if exists domain_orders_read on public.domain_orders;
create policy domain_orders_read on public.domain_orders for select
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.domain_orders from anon, authenticated;
grant select on public.domain_orders to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.domain_orders to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
