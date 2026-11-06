-- Agent coordination (additive): one shared "who is handling this customer right now" board for every agent in the platform —
-- the smart team (collections, re-engagement, review requests, abandoned carts, sales manager), the digital team (employees) and
-- the operator. Before an agent proactively reaches a customer for a purpose (outreach / money) or opens a follow-up (task), it
-- claims that customer for a window. Another agent asking for the same customer and purpose inside the window steps aside, and the
-- overlap it avoided is counted. The conversation guard (consent, caps, quiet hours) still applies on top of this.

create table if not exists public.agent_claims (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'deal', 'invoice', 'conversation')),
  entity_id uuid not null,
  lane text not null check (lane in ('outreach', 'money', 'task')),
  owner text not null check (char_length(owner) between 2 and 60),
  note text check (note is null or char_length(note) <= 200),
  claimed_at timestamptz not null default now(),
  until timestamptz not null,
  blocked_count int not null default 0,
  last_blocked_owner text check (last_blocked_owner is null or char_length(last_blocked_owner) <= 60),
  last_blocked_at timestamptz,
  primary key (organization_id, entity_type, entity_id, lane)
);
create index if not exists agent_claims_org_until on public.agent_claims (organization_id, until desc);
alter table public.agent_claims enable row level security;
grant select on public.agent_claims to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.agent_claims to service_role';
  end if;
end $$;
do $$ begin
  create policy agent_claims_select on public.agent_claims for select to authenticated using (public.is_org_member(organization_id));
exception when duplicate_object then null; end $$;

-- claim (atomic): granted when nobody holds it, the holder's window ended, it is the same owner (renewal) or p_force (a person asked)
create or replace function public.agent_claim(
  p_org uuid, p_entity_type text, p_entity_id uuid, p_lane text, p_owner text,
  p_minutes int default 1440, p_note text default null, p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.agent_claims;
  mins int := greatest(1, least(coalesce(p_minutes, 1440), 10080));
begin
  insert into public.agent_claims as c (organization_id, entity_type, entity_id, lane, owner, note, claimed_at, until)
  values (p_org, p_entity_type, p_entity_id, p_lane, left(p_owner, 60), left(p_note, 200), now(), now() + make_interval(mins => mins))
  on conflict (organization_id, entity_type, entity_id, lane) do update
     set owner = excluded.owner, note = coalesce(excluded.note, c.note), claimed_at = now(), until = excluded.until
   where c.until <= now() or c.owner = excluded.owner or p_force
  returning * into r;
  if r.organization_id is not null then
    return jsonb_build_object('granted', true, 'holder', r.owner, 'until', r.until);
  end if;
  update public.agent_claims c
     set blocked_count = c.blocked_count + 1, last_blocked_owner = left(p_owner, 60), last_blocked_at = now()
   where c.organization_id = p_org and c.entity_type = p_entity_type and c.entity_id = p_entity_id and c.lane = p_lane
  returning * into r;
  return jsonb_build_object('granted', false, 'holder', r.owner, 'until', r.until, 'note', r.note);
end;
$$;
revoke all on function public.agent_claim(uuid, text, uuid, text, text, int, text, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.agent_claim(uuid, text, uuid, text, text, int, text, boolean) to service_role';
  end if;
end $$;

-- release a fresh claim when the agent did not end up acting (e.g. no channel could reach the customer) — only the owner's own claim
create or replace function public.agent_release(p_org uuid, p_entity_type text, p_entity_id uuid, p_lane text, p_owner text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with u as (
    update public.agent_claims set until = now()
     where organization_id = p_org and entity_type = p_entity_type and entity_id = p_entity_id and lane = p_lane and owner = left(p_owner, 60) and until > now()
    returning 1
  ) select exists (select 1 from u);
$$;
revoke all on function public.agent_release(uuid, text, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.agent_release(uuid, text, uuid, text, text) to service_role';
  end if;
end $$;

-- what the business sees: who handles which customer now, and how many overlaps were avoided
create or replace function public.agent_coordination_overview(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity_type', a.entity_type, 'entity_id', a.entity_id, 'lane', a.lane, 'owner', a.owner, 'note', a.note, 'until', a.until,
               'blocked', a.blocked_count,
               'name', case a.entity_type
                         when 'contact' then (select trim(coalesce(k.first_name, '') || ' ' || coalesce(k.last_name, '')) from public.contacts k where k.id = a.entity_id)
                         when 'deal' then (select d.title from public.deals d where d.id = a.entity_id)
                         else null end
             ) order by a.claimed_at desc)
        from (select * from public.agent_claims where organization_id = p_org and until > now() order by claimed_at desc limit 30) a), '[]'::jsonb),
    'active_count', (select count(*) from public.agent_claims where organization_id = p_org and until > now()),
    'prevented_7d', (select coalesce(sum(blocked_count), 0) from public.agent_claims where organization_id = p_org and last_blocked_at > now() - interval '7 days'),
    'by_owner', coalesce((select jsonb_object_agg(owner, n) from (select split_part(owner, ':', 1) || ':' || split_part(owner, ':', 2) as owner, count(*) as n
                            from public.agent_claims where organization_id = p_org and claimed_at > now() - interval '7 days' group by 1) x), '{}'::jsonb)
  ) into out;
  return out;
end;
$$;
revoke all on function public.agent_coordination_overview(uuid) from public, anon;
grant execute on function public.agent_coordination_overview(uuid) to authenticated;

notify pgrst, 'reload schema';
