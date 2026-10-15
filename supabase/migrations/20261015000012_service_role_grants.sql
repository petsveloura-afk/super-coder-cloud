-- ============================================================================
-- SUPER CODER CLOUD — 0012 Explicit privileges for the server (service_role)
-- Supabase normally grants these through default privileges; we state them
-- explicitly so webhooks / background jobs never depend on project defaults.
-- service_role is server-only (never shipped to browsers) and bypasses RLS.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
    execute 'grant execute on function public.apply_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean) to service_role';
    execute 'alter default privileges in schema public grant select, insert, update, delete on tables to service_role';
    execute 'alter default privileges in schema public grant usage, select on sequences to service_role';
  end if;
end $$;
