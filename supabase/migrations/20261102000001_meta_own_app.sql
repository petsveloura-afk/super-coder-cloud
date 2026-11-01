-- Facebook / Instagram for every business, without waiting for the platform's Meta verification:
--   • meta_own_apps        — a business connects through ITS OWN free Meta app (the owner of an app has full access
--                            to their own Pages even while the app is in Development mode). App secret + webhook
--                            verify token are stored encrypted (secret_enc); only a hash of the verify token is
--                            kept in clear so the webhook can recognise it.
--   • meta_tester_requests — "add me as a tester of the platform app": the platform invites the person automatically
--                            through Meta's app-roles API; when Meta refuses, the request waits for a platform admin.
-- Additive and idempotent: two new tables (RLS on). Writes go through the server (service role) after permission checks.

create table if not exists public.meta_own_apps (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  app_id text not null check (app_id ~ '^\d{5,30}$'),
  app_name text check (app_name is null or char_length(app_name) <= 160),
  config_id text check (config_id is null or config_id ~ '^\d{5,30}$'),
  secret_enc text not null check (char_length(secret_enc) between 10 and 4000),
  verify_token_hash text not null check (verify_token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'saved' check (status in ('saved', 'connected', 'error')),
  webhooks_ok boolean not null default false,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists meta_own_apps_verify on public.meta_own_apps (verify_token_hash);
create index if not exists meta_own_apps_app on public.meta_own_apps (app_id);
alter table public.meta_own_apps enable row level security;
drop policy if exists meta_own_apps_read on public.meta_own_apps;
create policy meta_own_apps_read on public.meta_own_apps for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage'));
revoke insert, update, delete on public.meta_own_apps from anon, authenticated;
grant select on public.meta_own_apps to authenticated;

create table if not exists public.meta_tester_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  profile_ref text not null check (char_length(profile_ref) between 2 and 300),
  fb_user text check (fb_user is null or char_length(fb_user) <= 120),
  status text not null default 'pending' check (status in ('pending', 'invited', 'failed', 'done')),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meta_tester_requests_org on public.meta_tester_requests (organization_id, created_at desc);
create index if not exists meta_tester_requests_open on public.meta_tester_requests (status, created_at desc);
alter table public.meta_tester_requests enable row level security;
drop policy if exists meta_tester_requests_read on public.meta_tester_requests;
create policy meta_tester_requests_read on public.meta_tester_requests for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage') or public.is_platform_admin());
revoke insert, update, delete on public.meta_tester_requests from anon, authenticated;
grant select on public.meta_tester_requests to authenticated;

grant select, insert, update, delete on public.meta_own_apps to service_role;
grant select, insert, update, delete on public.meta_tester_requests to service_role;

notify pgrst, 'reload schema';
