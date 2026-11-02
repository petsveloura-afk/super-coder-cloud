-- Digital team, upgrade 2 — additive and idempotent (new table + one new column, nothing existing is touched).
--
--   team_model_health   one platform-wide row: the circuit-breaker state of every AI model (which model is being
--                       skipped for a while and why). Read/written by the server (service role) only.
--   team_tasks.attempts how many times a task was recovered / retried after a temporary failure (stops endless loops)
--
-- RLS is on. The health row has no policy for business users (it is platform data); only platform admins may read it.

create table if not exists public.team_model_health (
  id text primary key check (id ~ '^[a-z_]{2,30}$'),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 64000),
  updated_at timestamptz not null default now()
);

alter table public.team_model_health enable row level security;

drop policy if exists team_model_health_read on public.team_model_health;
create policy team_model_health_read on public.team_model_health for select to authenticated using (public.is_platform_admin());

revoke insert, update, delete on public.team_model_health from anon, authenticated;
grant select on public.team_model_health to authenticated;
grant select, insert, update, delete on public.team_model_health to service_role;

alter table public.team_tasks add column if not exists attempts int not null default 0 check (attempts >= 0 and attempts <= 20);
