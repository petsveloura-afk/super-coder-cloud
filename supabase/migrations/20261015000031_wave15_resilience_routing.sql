-- Wave 15 — resilience, conversation intelligence, lead routing, unified customer timeline.
-- ADDITIVE ONLY: new columns / tables / functions. Nothing existing is dropped or changed.

-- ------------------------------------------------- customer mood & intent (set by the agent)
alter table public.conversations add column if not exists sentiment text
  check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'angry'));
alter table public.conversations add column if not exists last_intent text
  check (last_intent is null or char_length(last_intent) <= 40);

-- ------------------------------------------------- watchdog: customers left without an answer
-- A chat in "auto" mode whose latest customer message waited 2+ minutes with no real answer
-- (last message is the customer's, or only the short "I'm on it" holding message).
create or replace function public.ai_stuck_conversations(p_limit int default 20)
returns table (conversation_id uuid, organization_id uuid, channel text, waiting_seconds int, language text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.organization_id, c.channel, extract(epoch from (now() - li.created_at))::int, ag.language
    from public.conversations c
    join lateral (
      select m.created_at from public.messages m
       where m.conversation_id = c.id and m.direction = 'in'
       order by m.created_at desc limit 1
    ) li on true
    join lateral (
      select m.direction, m.meta from public.messages m
       where m.conversation_id = c.id
       order by m.created_at desc limit 1
    ) lm on true
    join lateral (
      select a.language from public.ai_agents a
       where a.organization_id = c.organization_id and a.enabled and c.channel = any (a.autopilot_channels)
       order by a.created_at limit 1
    ) ag on true
   where c.ai_mode = 'auto'
     and c.status = 'open'
     and li.created_at > now() - interval '24 hours'
     and li.created_at < now() - interval '2 minutes'
     and not (c.channel in ('telegram', 'telegram_user') and c.external_id like '-%')
     and coalesce(lm.meta ->> 'automated', '') <> 'true'
     and (lm.direction = 'in' or coalesce(lm.meta ->> 'fallback', '') = 'true')
   order by li.created_at
   limit greatest(1, least(p_limit, 100));
$$;

-- ------------------------------------------------- lead routing (round robin between reps)
create table if not exists public.lead_routing (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  roles text[] not null default array['sales', 'manager']::text[],
  last_user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.lead_routing enable row level security;
drop policy if exists lead_routing_read on public.lead_routing;
create policy lead_routing_read on public.lead_routing for select using (public.is_org_member(organization_id));
revoke insert, update, delete on public.lead_routing from anon, authenticated;
grant select on public.lead_routing to authenticated;

-- Next rep in turn (stable order by user id, wraps around). NULL when routing is off or nobody is eligible.
create or replace function public.assign_next_rep(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.lead_routing;
  nxt uuid;
begin
  select * into r from public.lead_routing where organization_id = p_org and enabled for update;
  if r.organization_id is null then return null; end if;
  select m.user_id into nxt
    from public.organization_members m
   where m.organization_id = p_org
     and m.role::text = any (r.roles)
     and (r.last_user_id is null or m.user_id > r.last_user_id)
   order by m.user_id
   limit 1;
  if nxt is null then
    select m.user_id into nxt
      from public.organization_members m
     where m.organization_id = p_org and m.role::text = any (r.roles)
     order by m.user_id
     limit 1;
  end if;
  if nxt is not null then
    update public.lead_routing set last_user_id = nxt, updated_at = now() where organization_id = p_org;
  end if;
  return nxt;
end;
$$;

-- New contacts and deals without an owner get the next rep (only where routing is switched on).
create or replace function public.route_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is null then
    new.owner_id := public.assign_next_rep(new.organization_id);
  end if;
  return new;
end;
$$;
drop trigger if exists contacts_route_owner on public.contacts;
create trigger contacts_route_owner before insert on public.contacts for each row execute function public.route_new_owner();
drop trigger if exists deals_route_owner on public.deals;
create trigger deals_route_owner before insert on public.deals for each row execute function public.route_new_owner();

-- ------------------------------------------------- one timeline per customer, across channels
-- The same person writing on WhatsApp, Telegram and e-mail: contacts that share an e-mail or the
-- last 9 digits of a phone number are treated as one customer. SECURITY INVOKER → row security applies.
create or replace function public.customer_timeline(p_contact uuid, p_limit int default 150)
returns table (at timestamptz, channel text, direction text, body text, conversation_id uuid, contact_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with base as (
    select c.id, c.organization_id, lower(nullif(trim(c.email), '')) as email,
           nullif(right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9), '') as tail
      from public.contacts c where c.id = p_contact
  ),
  same as (
    select c.id
      from public.contacts c, base b
     where c.organization_id = b.organization_id
       and (c.id = b.id
            or (b.email is not null and lower(c.email) = b.email)
            or (b.tail is not null and length(b.tail) = 9 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = b.tail))
  )
  select m.created_at, cv.channel, m.direction, m.body, cv.id, cv.contact_id
    from public.conversations cv
    join public.messages m on m.conversation_id = cv.id
   where cv.contact_id in (select id from same)
   order by m.created_at desc
   limit greatest(1, least(p_limit, 500));
$$;

-- ------------------------------------------------- privileges
do $$ begin
  execute 'revoke execute on function public.ai_stuck_conversations(int) from public, anon, authenticated';
  execute 'revoke execute on function public.assign_next_rep(uuid) from public, anon, authenticated';
  execute 'revoke execute on function public.route_new_owner() from public, anon, authenticated';
  execute 'revoke execute on function public.customer_timeline(uuid, int) from public, anon';
  execute 'grant execute on function public.customer_timeline(uuid, int) to authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_stuck_conversations(int) to service_role';
    execute 'grant execute on function public.assign_next_rep(uuid) to service_role';
    execute 'grant execute on function public.customer_timeline(uuid, int) to service_role';
    execute 'grant select, insert, update, delete on public.lead_routing to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
