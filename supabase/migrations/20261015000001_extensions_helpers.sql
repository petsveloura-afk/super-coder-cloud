-- ============================================================================
-- SUPER CODER CLOUD — 0001 Extensions, enums, shared helpers
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- Organization-scoped roles. Platform super admins are tracked separately
-- in public.platform_admins and never derive tenant data access from it.
do $$ begin
  create type public.org_role as enum (
    'agency_owner', 'owner', 'admin', 'manager', 'marketing',
    'sales', 'support', 'analyst', 'client', 'read_only'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contact_status as enum ('lead', 'qualified', 'customer', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deal_status as enum ('open', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('open', 'in_progress', 'done', 'canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.integration_status as enum ('not_configured', 'pending', 'active', 'error', 'disabled');
exception when duplicate_object then null; end $$;

-- Generic updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
