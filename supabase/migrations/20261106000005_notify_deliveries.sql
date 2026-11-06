-- Team alerts that never get lost (additive). Every alert to a team recipient about a customer message (WhatsApp / Telegram /
-- e-mail / SMS) is recorded once per recipient + event + customer message:
--   • a delivery that failed (the WhatsApp bridge was reconnecting, the official API refused, a timeout) is retried with growing
--     pauses instead of being lost;
--   • the same alert is never sent twice (the normal path and the catch-up path share this ledger);
--   • an alert that was never even attempted (the server ran out of time after the agent replied) is caught up by the sweep.
-- notify_recipients is unchanged.

create table if not exists public.notify_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references public.notify_recipients (id) on delete cascade,
  event text not null check (event in ('messages', 'leads', 'handoff', 'daily')),
  conversation_id uuid,
  message_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 24000),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'gave_up')),
  attempts int not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (recipient_id, event, message_id)
);
create index if not exists notify_deliveries_due on public.notify_deliveries (next_at) where status in ('pending', 'failed');
create index if not exists notify_deliveries_conv on public.notify_deliveries (organization_id, message_id);
alter table public.notify_deliveries enable row level security;
do $$ begin
  create policy notify_deliveries_select on public.notify_deliveries for select to authenticated
    using (public.has_permission(organization_id, 'integrations.manage'));
exception when duplicate_object then null; end $$;
grant select on public.notify_deliveries to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.notify_deliveries to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
