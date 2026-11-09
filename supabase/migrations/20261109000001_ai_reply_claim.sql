-- wave A4 — one AI answer per customer message (additive: one new table + one new function, nothing existing is touched).
-- The webhook run, the safety-net cron, the bridge tick and the watchdog could answer the same message at the same moment.
create table if not exists public.ai_reply_claims (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  message_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.ai_reply_claims enable row level security; -- no policies: only the service role (which bypasses RLS) uses it

create or replace function public.ai_claim_reply(p_conversation uuid, p_message uuid, p_ttl_seconds int default 150)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare got uuid;
begin
  -- the first run to claim a message wins; the same message can be claimed again only after the ttl (the first run died)
  insert into public.ai_reply_claims as c (conversation_id, message_id, claimed_at)
  values (p_conversation, p_message, now())
  on conflict (conversation_id) do update
     set message_id = excluded.message_id, claimed_at = now()
   where c.message_id <> excluded.message_id
      or c.claimed_at < now() - make_interval(secs => greatest(p_ttl_seconds, 10))
  returning c.conversation_id into got;
  return got is not null;
end;
$$;
do $$ begin
  execute 'revoke execute on function public.ai_claim_reply(uuid, uuid, int) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_claim_reply(uuid, uuid, int) to service_role';
  end if;
end $$;
