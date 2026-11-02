-- Digital team, upgrade 4 — market & competitor intelligence. Additive and idempotent: ONE new table, nothing existing is touched.
--
--   team_market_findings   one row per public finding about a competitor / the market: what, the value (if numeric),
--                          the source link, when it was read, how confident we are and why. APPEND-ONLY history: rows are
--                          never updated or deleted, so "what changed since the last scan" is always answerable.
--
-- RLS: members with ai.use can read their own business's rows; only the server (service_role) can insert. Nobody can
-- update or delete. Without this migration the team keeps working — the market tools answer "migration_not_applied".
-- Run it in the Supabase SQL Editor. Safe to run twice.

create table if not exists public.team_market_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competitor text not null check (char_length(competitor) between 1 and 120),
  kind text not null check (kind in ('price', 'promo', 'product', 'review', 'trend')),
  subject text not null check (char_length(subject) between 1 and 160),
  subject_key text not null check (char_length(subject_key) <= 400),
  summary text not null check (char_length(summary) between 1 and 600),
  value numeric,
  currency text check (currency is null or char_length(currency) <= 6),
  source_url text not null check (source_url ~ '^https?://' and char_length(source_url) <= 600),
  source_kind text not null default 'unknown' check (source_kind in ('official_site', 'press', 'review_site', 'social', 'directory', 'unknown')),
  observed_at timestamptz not null,
  scan_day date not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  confidence_reason text not null default '' check (char_length(confidence_reason) <= 400),
  recorded_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists team_market_findings_lookup
  on public.team_market_findings (organization_id, scan_day desc, competitor);
create index if not exists team_market_findings_key
  on public.team_market_findings (organization_id, subject_key, observed_at desc);

alter table public.team_market_findings enable row level security;

drop policy if exists team_market_findings_read on public.team_market_findings;
create policy team_market_findings_read on public.team_market_findings
  for select to authenticated using (public.has_permission(organization_id, 'ai.use'));

revoke insert, update, delete on public.team_market_findings from anon, authenticated;
grant select on public.team_market_findings to authenticated;
grant select, insert on public.team_market_findings to service_role;

notify pgrst, 'reload schema';
