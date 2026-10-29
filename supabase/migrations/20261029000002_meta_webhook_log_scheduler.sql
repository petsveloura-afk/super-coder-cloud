-- Facebook / Instagram: see what Meta delivers, and pull messages on a server clock (additive, idempotent).
-- Nothing existing is changed or dropped.

-- 1) A small log of what the Meta webhook receives / rejects (no message text, no personal data).
--    Server only: row level security is on and there is no policy, so only the service role can read or write it.
create table if not exists public.meta_webhook_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  status text not null,          -- received | bad_signature | no_account | error
  object text,                   -- page | instagram
  entry_id text,                 -- Facebook Page id / Instagram account id
  detail text
);
create index if not exists meta_webhook_events_created_idx on public.meta_webhook_events (created_at desc);
alter table public.meta_webhook_events enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, delete on public.meta_webhook_events to service_role';
  end if;
end $$;

-- 2) Optional server-side clock (Supabase pg_cron + pg_net): calls the site every 30 seconds so customers'
--    Facebook / Instagram messages are fetched and answered even when nobody is logged in and GitHub's
--    scheduler is late. Run ONCE from the Supabase SQL editor (it needs the site URL and CRON_SECRET):
--      select public.schedule_meta_inbound_sync('https://<your-site>', '<CRON_SECRET>');
--    Remove it with:  select public.unschedule_meta_inbound_sync();
create or replace function public.schedule_meta_inbound_sync(p_site_url text, p_cron_secret text, p_every text default '30 seconds')
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  url text := rtrim(btrim(p_site_url), '/') || '/api/cron/meta-sync';
  job text;
begin
  if p_site_url !~ '^https://[^\s]+$' then raise exception 'site url must start with https://'; end if;
  if length(coalesce(p_cron_secret, '')) < 8 then raise exception 'cron secret is too short'; end if;
  if p_every !~ '^([0-9]+ seconds|[0-9*/, -]+( [0-9*/, -]+){4})$' then raise exception 'bad schedule'; end if;
  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net with schema extensions';
  begin
    execute 'select cron.unschedule(''meta-inbound-sync'')';
  exception when others then null;
  end;
  execute format(
    'select cron.schedule(%L, %L, %L)',
    'meta-inbound-sync',
    p_every,
    format('select net.http_post(url := %L, headers := jsonb_build_object(''Authorization'', %L, ''Content-Type'', ''application/json''), body := ''{}''::jsonb, timeout_milliseconds := 50000)', url, 'Bearer ' || p_cron_secret)
  ) into job;
  return 'scheduled ' || url || ' ' || p_every;
end;
$$;

create or replace function public.unschedule_meta_inbound_sync()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  begin
    execute 'select cron.unschedule(''meta-inbound-sync'')';
    return 'unscheduled';
  exception when others then
    return 'nothing to unschedule';
  end;
end;
$$;

revoke execute on function public.schedule_meta_inbound_sync(text, text, text) from public, anon, authenticated;
revoke execute on function public.unschedule_meta_inbound_sync() from public, anon, authenticated;

notify pgrst, 'reload schema';
