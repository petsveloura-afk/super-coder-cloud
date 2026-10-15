-- SUPER CODER CLOUD — seed (runs after migrations on `supabase db reset`).
-- Intentionally contains NO tenant data and NO users: data belongs to real
-- organizations created through the app.
--
-- Demo data is loaded per-workspace from the dashboard ("Load demo data"),
-- which calls public.load_demo_data(org) — fictional, flagged is_demo, and
-- only allowed into an empty workspace by a user with settings.manage.

-- Global feature flags (off by default; Phase 3+ features read these).
insert into public.feature_flags (key, organization_id, enabled) values
  ('automations.beta', null, false),
  ('ai_agents.beta', null, false)
on conflict do nothing;
