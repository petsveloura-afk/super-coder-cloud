-- =============================================================================
-- Wave 24 — saved replies for the inbox (the team's ready answers, one click to insert).
--  * saved_replies: per organization; every member reads them, members who may reply write them.
--  * use_count / last_used_at: the most used answers come first.
-- Additive: nothing existing changes.
-- =============================================================================

create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  shortcut text check (shortcut is null or shortcut ~ '^[a-z0-9֐-׿_-]{1,24}$'),
  use_count int not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_replies_org on public.saved_replies (organization_id, use_count desc, created_at desc);
create unique index if not exists saved_replies_shortcut on public.saved_replies (organization_id, shortcut) where shortcut is not null;

alter table public.saved_replies enable row level security;
drop policy if exists saved_replies_read on public.saved_replies;
create policy saved_replies_read on public.saved_replies for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists saved_replies_insert on public.saved_replies;
create policy saved_replies_insert on public.saved_replies for insert to authenticated with check (public.has_permission(organization_id, 'inbox.reply'));
drop policy if exists saved_replies_update on public.saved_replies;
create policy saved_replies_update on public.saved_replies for update to authenticated
  using (public.has_permission(organization_id, 'inbox.reply')) with check (public.has_permission(organization_id, 'inbox.reply'));
drop policy if exists saved_replies_delete on public.saved_replies;
create policy saved_replies_delete on public.saved_replies for delete to authenticated using (public.has_permission(organization_id, 'inbox.reply'));
grant select, insert, update, delete on public.saved_replies to authenticated;
revoke all on public.saved_replies from anon;

-- a member used an answer: count it (no other column may change through this path)
create or replace function public.use_saved_reply(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
begin
  select organization_id into org from public.saved_replies where id = p_id;
  if org is null or not public.has_permission(org, 'inbox.reply') then return; end if;
  update public.saved_replies set use_count = use_count + 1, last_used_at = now() where id = p_id;
end;
$$;
revoke all on function public.use_saved_reply(uuid) from public, anon;
grant execute on function public.use_saved_reply(uuid) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.saved_replies to service_role';
    execute 'grant execute on function public.use_saved_reply(uuid) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
