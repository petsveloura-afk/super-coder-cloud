-- ============================================================================
-- SUPER CODER CLOUD — 0002 Users, organizations, memberships, RBAC
-- ============================================================================

-- Public profile mirror of auth.users (one row per user).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  locale text not null default 'he' check (locale in ('he', 'ar', 'en')),
  default_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and char_length(slug) between 3 and 48),
  -- Agency hierarchy: a client workspace may belong to an agency organization.
  parent_organization_id uuid references public.organizations (id) on delete restrict,
  locale text not null default 'he' check (locale in ('he', 'ar', 'en')),
  timezone text not null default 'Asia/Jerusalem',
  currency char(3) not null default 'ILS',
  plan text not null default 'free',
  is_demo boolean not null default false,
  branding jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.profiles
  drop constraint if exists profiles_default_org_fk,
  add constraint profiles_default_org_fk foreign key (default_organization_id)
    references public.organizations (id) on delete set null;

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'read_only',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- Catalogue of permissions + role mapping (seeded in 0003, mirrors packages/shared/src/permissions.ts)
create table if not exists public.permissions (
  key text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null default ''
);

create table if not exists public.roles (
  key public.org_role primary key,
  rank int not null
);

create table if not exists public.role_permissions (
  role public.org_role not null references public.roles (key) on delete cascade,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role public.org_role not null default 'read_only',
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invitations_org_idx on public.invitations (organization_id);

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER, fixed search_path, STABLE).
-- They read memberships for auth.uid() only; they never accept a user id
-- from the caller, which prevents probing other users' permissions.
-- ---------------------------------------------------------------------------

create or replace function public.current_role_in(org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id and o.deleted_at is null
  where m.organization_id = org and m.user_id = auth.uid();
$$;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_in(org) is not null;
$$;

create or replace function public.has_permission(org uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id and o.deleted_at is null
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = org
      and m.user_id = auth.uid()
      and rp.permission = perm
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Shared-org check used for profile visibility.
create or replace function public.shares_org_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ---------------------------------------------------------------------------
-- New auth user → profile row
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    case when new.raw_user_meta_data ->> 'locale' in ('he', 'ar', 'en')
         then new.raw_user_meta_data ->> 'locale' else 'he' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership guards: no privilege escalation, never remove the last owner.
-- ---------------------------------------------------------------------------
create or replace function public.guard_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role public.org_role;
  actor_rank int;
  target_rank int;
  old_rank int;
  owners_left int;
begin
  -- Service role / migrations (no JWT) bypass these checks deliberately.
  if auth.uid() is null or current_setting('scc.bootstrap', true) = 'on' then
    return coalesce(new, old);
  end if;

  actor_role := public.current_role_in(coalesce(new.organization_id, old.organization_id));
  select rank into actor_rank from public.roles where key = actor_role;

  if tg_op in ('INSERT', 'UPDATE') then
    select rank into target_rank from public.roles where key = new.role;
    if actor_rank is null or target_rank > actor_rank then
      raise exception 'cannot assign a role above your own' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.user_id = auth.uid() and new.role <> old.role then
      raise exception 'cannot change your own role' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select rank into old_rank from public.roles where key = old.role;
    if actor_rank is null or old_rank > actor_rank then
      raise exception 'cannot modify a member above your role' using errcode = '42501';
    end if;
    if old.role in ('owner', 'agency_owner') and (tg_op = 'DELETE' or new.role not in ('owner', 'agency_owner')) then
      select count(*) into owners_left
      from public.organization_members
      where organization_id = old.organization_id
        and role in ('owner', 'agency_owner')
        and user_id <> old.user_id;
      if owners_left = 0 then
        raise exception 'organization must keep at least one owner' using errcode = '23514';
      end if;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_members_guard on public.organization_members;
create trigger organization_members_guard
  before insert or update or delete on public.organization_members
  for each row execute function public.guard_membership_change();

-- ---------------------------------------------------------------------------
-- RPC: create organization (caller becomes owner). Atomic.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_locale text default 'he',
  p_timezone text default 'Asia/Jerusalem',
  p_currency text default 'ILS'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  org_id uuid;
  pipe_id uuid;
  owned int;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Abuse guard: max 20 organizations created per user.
  select count(*) into owned from public.organizations where created_by = uid and deleted_at is null;
  if owned >= 20 then
    raise exception 'organization limit reached' using errcode = '54000';
  end if;

  insert into public.organizations (name, slug, locale, timezone, currency, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_locale, p_timezone, upper(p_currency), uid)
  returning id into org_id;

  -- Bypass membership guard for bootstrap: insert as definer with explicit owner role.
  perform set_config('scc.bootstrap', 'on', true);
  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, uid, 'owner');
  perform set_config('scc.bootstrap', 'off', true);

  update public.profiles set default_organization_id = org_id
  where id = uid and default_organization_id is null;

  -- Default sales pipeline
  insert into public.pipelines (organization_id, name, is_default)
  values (org_id, 'Sales', true)
  returning id into pipe_id;

  insert into public.pipeline_stages (organization_id, pipeline_id, name, position, probability)
  values
    (org_id, pipe_id, 'New', 0, 10),
    (org_id, pipe_id, 'Qualified', 1, 30),
    (org_id, pipe_id, 'Proposal', 2, 60),
    (org_id, pipe_id, 'Negotiation', 3, 80);

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (org_id, uid, 'organization.created', 'organization', org_id);

  return org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: accept invitation by raw token (only the hash is stored).
-- ---------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  inv public.invitations;
  user_email text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into inv from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and accepted_at is null
    and expires_at > now()
  for update;

  if inv.id is null then
    raise exception 'invitation invalid or expired' using errcode = 'P0002';
  end if;

  select email into user_email from auth.users where id = uid;
  if lower(user_email) <> lower(inv.email::text) then
    raise exception 'invitation issued to a different email' using errcode = '42501';
  end if;

  perform set_config('scc.bootstrap', 'on', true);
  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (inv.organization_id, uid, inv.role, inv.invited_by)
  on conflict (organization_id, user_id) do nothing;
  perform set_config('scc.bootstrap', 'off', true);

  update public.invitations set accepted_at = now() where id = inv.id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (inv.organization_id, uid, 'member.joined', 'invitation', inv.id);

  return inv.organization_id;
end;
$$;

-- Can the current user grant `target` in `org`? (members.invite + rank check)
create or replace function public.can_assign_role(org uuid, target public.org_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission(org, 'members.invite')
     and (select rank from public.roles where key = target)
         <= (select r.rank from public.roles r where r.key = public.current_role_in(org));
$$;
