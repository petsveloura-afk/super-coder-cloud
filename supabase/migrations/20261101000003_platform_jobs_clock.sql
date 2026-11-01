-- Reliable background clock: GitHub's scheduled workflows are often delayed by hours, so every background job
-- (publishing due posts, the daily social post, automations queue, follow-ups, growth tasks, AI agents, billing)
-- is also called from inside the database with pg_cron + pg_net (free on every Supabase plan), staggered over the
-- 5 minutes. The GitHub workflow stays as a backup; the job lock (job_runs) makes a double call harmless.
-- Same pattern as schedule_meta_inbound_sync (wave 44). Additive: two new functions, nothing existing changes.

create or replace function public.schedule_platform_jobs(p_site_url text, p_cron_secret text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  base text := rtrim(btrim(p_site_url), '/');
  jobs text[][] := array[
    array['scc-social',        '*/2 * * * *',     '/api/cron/social'],
    array['scc-dispatch',      '1-59/5 * * * *',  '/api/jobs/dispatch'],
    array['scc-followups',     '2-59/5 * * * *',  '/api/ai/followups'],
    array['scc-growth',        '3-59/5 * * * *',  '/api/cron/growth'],
    array['scc-social-brain',  '4-59/5 * * * *',  '/api/cron/social-brain'],
    array['scc-agents',        '0-59/10 * * * *', '/api/cron/agents'],
    array['scc-billing-sweep', '17 * * * *',      '/api/billing/sweep']
  ];
  j text[];
  n int := 0;
begin
  if p_site_url !~ '^https://[^\s]+$' then raise exception 'site url must start with https://'; end if;
  if length(coalesce(p_cron_secret, '')) < 8 then raise exception 'cron secret is too short'; end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';
  foreach j slice 1 in array jobs loop
    begin
      execute format('select cron.unschedule(%L)', j[1]);
    exception when others then null;
    end;
    execute format(
      'select cron.schedule(%L, %L, %L)',
      j[1],
      j[2],
      format('select net.http_post(url := %L, headers := jsonb_build_object(''Authorization'', %L, ''Content-Type'', ''application/json''), body := ''{}''::jsonb, timeout_milliseconds := 58000)', base || j[3], 'Bearer ' || p_cron_secret)
    );
    n := n + 1;
  end loop;
  return 'scheduled ' || n || ' jobs on ' || base;
end;
$$;

create or replace function public.unschedule_platform_jobs()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  name text;
  n int := 0;
begin
  foreach name in array array['scc-social', 'scc-dispatch', 'scc-followups', 'scc-growth', 'scc-social-brain', 'scc-agents', 'scc-billing-sweep'] loop
    begin
      execute format('select cron.unschedule(%L)', name);
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return 'unscheduled ' || n;
end;
$$;

revoke execute on function public.schedule_platform_jobs(text, text) from public, anon, authenticated;
revoke execute on function public.unschedule_platform_jobs() from public, anon, authenticated;

notify pgrst, 'reload schema';
