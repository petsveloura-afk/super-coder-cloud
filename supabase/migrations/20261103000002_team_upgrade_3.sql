-- Digital team, upgrade 3 — additive and idempotent (two new columns + two indexes; nothing existing is touched).
--
--   team_settings.ops          the business's operating rules as ONE json object: quiet hours, SLA target, digests,
--                              duplicate removal, protections. The app cleans every value on read, so '{}' = the safe defaults.
--   team_approvals.confirmations   how many explicit confirmations a money / irreversible approval already has (0 or 1);
--                              the second click runs the action. Without this column the team falls back to a single approval.
--   two partial indexes        the once-a-day digest / memory-upkeep markers, and the per-employee tool-call history used by the rate limit.
--
-- RLS: both tables already have RLS on with their existing policies; new columns inherit them (no new policy needed).
-- Run it in the Supabase SQL Editor. Safe to run twice.

alter table public.team_settings
  add column if not exists ops jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_settings_ops_is_object') then
    alter table public.team_settings add constraint team_settings_ops_is_object check (jsonb_typeof(ops) = 'object' and pg_column_size(ops) < 4000);
  end if;
end $$;

alter table public.team_approvals
  add column if not exists confirmations int not null default 0 check (confirmations >= 0 and confirmations <= 5);

create index if not exists team_activity_digest_marker
  on public.team_activity (organization_id, (details->>'digest'), created_at desc)
  where details ? 'digest';

create index if not exists team_activity_tool_calls
  on public.team_activity (organization_id, member_id, created_at desc)
  where phase = 'execute' and ok;
