-- Promote an EXISTING, signed-up user to Platform Super Admin.
-- Run with a privileged connection (Supabase SQL editor, or psql with the
-- database password). Never expose this through the application.
--
--   psql "$DATABASE_URL" -v email='you@example.com' -f scripts/setup/create-platform-admin.sql
--
-- Platform admin does NOT grant access to tenant data through RLS; it only
-- unlocks platform-level screens (Phase 6/7) that use separate checks.

insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower(:'email')
on conflict (user_id) do nothing
returning user_id;
