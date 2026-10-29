-- Wave 45 / stage A — social asset library (images the business generated or saved for posts).
-- Additive only: one new table. social_posts (and its platforms constraint) is NOT touched.
-- Access mirrors social_posts: read = campaigns.manage or analytics.read, write = campaigns.manage.

create table if not exists public.social_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'image' check (kind in ('image')),
  url text not null check (url ~ '^https://' and char_length(url) <= 1000),
  title text check (title is null or char_length(title) <= 200),
  prompt text check (prompt is null or char_length(prompt) <= 1800),
  source text not null default 'ai' check (source in ('ai', 'url')),
  model text check (model is null or char_length(model) <= 120),
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 10),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists social_assets_org_url on public.social_assets (organization_id, url);
create index if not exists social_assets_org_created on public.social_assets (organization_id, created_at desc);

alter table public.social_assets enable row level security;

drop policy if exists social_assets_read on public.social_assets;
create policy social_assets_read on public.social_assets for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage') or public.has_permission(organization_id, 'analytics.read'));

drop policy if exists social_assets_write on public.social_assets;
create policy social_assets_write on public.social_assets for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage'))
  with check (public.has_permission(organization_id, 'campaigns.manage'));

grant select, insert, update, delete on public.social_assets to authenticated;

-- same generic audit trigger the other tenant tables use
drop trigger if exists social_assets_audit on public.social_assets;
create trigger social_assets_audit after insert or update or delete on public.social_assets
  for each row execute function public.audit_row_change();
