-- Wave 57 — zero-setup phone for businesses: the platform owner connects ONE Twilio account, and every
-- business on the Business plan gets its own phone number for the AI agent in one click (or the platform
-- admin assigns one). Calls on platform numbers are metered (monthly minutes).
-- Additive and idempotent: one new table (members read, server writes) and one new column with a default.

create table if not exists public.org_phone_numbers (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  phone_number text not null unique check (phone_number ~ '^\+\d{8,15}$'),
  number_sid text check (number_sid is null or number_sid ~ '^PN[0-9a-fA-F]{32}$'),
  source text not null default 'platform' check (source in ('platform', 'assigned')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now()
);
alter table public.org_phone_numbers enable row level security;
drop policy if exists org_phone_numbers_read on public.org_phone_numbers;
create policy org_phone_numbers_read on public.org_phone_numbers for select to authenticated
  using (public.is_org_member(organization_id));
grant select on public.org_phone_numbers to authenticated;

-- which Twilio account carried the call: the business's own, or the platform's (metered)
alter table public.voice_calls add column if not exists via text not null default 'own';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voice_calls_via_check') then
    alter table public.voice_calls add constraint voice_calls_via_check check (via in ('own', 'platform'));
  end if;
end $$;
create index if not exists voice_calls_org_month on public.voice_calls (organization_id, created_at) where via = 'platform';

notify pgrst, 'reload schema';
