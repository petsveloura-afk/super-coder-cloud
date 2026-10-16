-- ============================================================================
-- SUPER CODER CLOUD — 0026: AI router
--   Shared "rest" list of AI provider keys / models that just hit a limit
--   (per-minute limit, daily quota, retired model, bad key), so every server
--   instance skips them instead of hammering them — and moves on to the next
--   provider at once.
-- Additive only.
-- ============================================================================

create table if not exists public.ai_provider_rests (
  -- "<provider>:…<last6>|<model>", "<provider>|*|<model>" or "<provider>:…<last6>|*" — never a key itself
  id text primary key check (char_length(id) between 3 and 300),
  until timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 200),
  updated_at timestamptz not null default now()
);
create index if not exists ai_provider_rests_until_idx on public.ai_provider_rests (until);
alter table public.ai_provider_rests enable row level security;
revoke all on public.ai_provider_rests from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.ai_provider_rests to service_role';
  end if;
end $$;

-- housekeeping: old rests are useless
create or replace function public.ai_provider_rests_prune()
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  with d as (delete from public.ai_provider_rests where until < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
do $$ begin
  execute 'revoke execute on function public.ai_provider_rests_prune() from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_provider_rests_prune() to service_role';
  end if;
end $$;

-- conversations still parked with a person only because the AI was busy go back to the agent
update public.conversations c
   set ai_mode = 'auto', handoff_at = null
 where c.ai_mode = 'human'
   and c.id::text in (
         select substring(n.link from 'c=([0-9a-f-]{36})')
           from public.notifications n
          where n.title_key = 'inbox.handoffNotification' and coalesce(n.params ->> 'reason', '') like 'ai.%')
   and not exists (
         select 1 from public.messages m
          where m.conversation_id = c.id and m.direction = 'out' and m.sent_by is not null
            and m.created_at >= coalesce(c.handoff_at, c.created_at));

notify pgrst, 'reload schema';
