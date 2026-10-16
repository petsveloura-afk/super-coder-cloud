-- ============================================================================
-- SUPER CODER CLOUD — 0013 Scheduled maintenance (runs from the daily cron)
-- Same jobs as apps/worker, so the platform needs NO separate worker host:
-- the Vercel Cron → /api/keepalive call executes this with the service role.
-- Idempotent and safe to run any number of times.
-- ============================================================================
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv int;
  notif int;
  rl int;
  pending int;
begin
  -- invitations that expired more than 30 days ago and were never accepted
  delete from public.invitations
   where accepted_at is null and expires_at < now() - interval '30 days';
  get diagnostics inv = row_count;

  -- read notifications older than 90 days
  delete from public.notifications
   where read_at is not null and created_at < now() - interval '90 days';
  get diagnostics notif = row_count;

  -- rate-limit windows older than 2 days
  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics rl = row_count;

  -- AI reservations stuck in 'pending' (crashed request) for > 1 hour: release, cost 0
  update public.ai_usage set status = 'error', credits = 0
   where status = 'pending' and created_at < now() - interval '1 hour';
  get diagnostics pending = row_count;

  return jsonb_build_object(
    'invitations_purged', inv,
    'notifications_purged', notif,
    'rate_limit_rows_purged', rl,
    'ai_pending_released', pending,
    'ran_at', now()
  );
end;
$$;

revoke execute on function public.run_maintenance() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.run_maintenance() to service_role';
  end if;
end $$;

-- make the new RPC visible to the REST API immediately
notify pgrst, 'reload schema';
