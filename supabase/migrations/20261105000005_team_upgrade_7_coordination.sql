-- Digital team, upgrade 7 / stage G — the shared board and handoff contracts. Additive and idempotent: ONE new table.
--   team_board_notes   notes employees post for each other (blocker / finding / request / status) and the daily stand-up text.
--                      Append-only by convention (the server never edits a note); status of REAL work stays in team_tasks.
-- RLS: members with ai.use read; only the server (service_role) writes. Without it the board tools answer "migration_not_applied".
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_board_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete set null,
  kind text not null check (kind in ('blocker', 'finding', 'request', 'status', 'standup', 'contract')),
  title text not null check (char_length(title) between 2 and 200),
  detail text check (detail is null or char_length(detail) <= 2000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 20000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists team_board_notes_org on public.team_board_notes (organization_id, created_at desc);

alter table public.team_board_notes enable row level security;
drop policy if exists team_board_notes_read on public.team_board_notes;
create policy team_board_notes_read on public.team_board_notes
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));
revoke insert, update, delete on public.team_board_notes from anon, authenticated;
grant select on public.team_board_notes to authenticated;
grant select, insert, update on public.team_board_notes to service_role;

notify pgrst, 'reload schema';
