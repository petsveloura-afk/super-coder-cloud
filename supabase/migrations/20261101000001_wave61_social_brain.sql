-- Wave 61 — the social brain:
--   • daily autopilot: a ready post (text + image or video) every day, at the hour the business chose
--   • content pillars, hashtag bank, words to avoid, holidays, reviews → testimonial posts
--   • learning: real engagement per published post (likes / comments / shares) → what works, best hours
--   • a Telegram channel as an extra destination for every post
-- Additive and idempotent: new tables (RLS on), nullable / defaulted columns, one new function.
-- Nothing existing is dropped, renamed or rewritten; existing posts keep NULL / defaults in the new columns.

-- ------------------------------------------------------------ the autopilot settings ----
create table if not exists public.social_autopilot (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  -- draft = waits for approval, auto = scheduled and published by itself
  mode text not null default 'draft' check (mode in ('draft', 'auto')),
  post_time text not null default '10:00' check (post_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 0 = Sunday … 6 = Saturday
  days int[] not null default array[0, 1, 2, 3, 4, 5]::int[] check (days <@ array[0, 1, 2, 3, 4, 5, 6]::int[] and cardinality(days) between 1 and 7),
  platforms text[] not null default array['facebook', 'instagram']::text[] check (platforms <@ array['facebook', 'instagram']::text[] and cardinality(platforms) between 1 and 2),
  media text not null default 'image' check (media in ('image', 'video', 'mix', 'none')),
  style text not null default 'auto' check (style in ('auto', 'photo', 'cinematic', 'illustration', '3d', 'minimal', 'flatlay')),
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'playful', 'premium')),
  pillars text[] not null default array[]::text[] check (cardinality(pillars) <= 12),
  hashtags text[] not null default array[]::text[] check (cardinality(hashtags) <= 30),
  avoid text check (avoid is null or char_length(avoid) <= 500),
  cta_type text check (cta_type is null or cta_type in ('message', 'whatsapp', 'call', 'book', 'learn_more', 'shop', 'sign_up', 'order')),
  cta_value text check (cta_value is null or char_length(cta_value) <= 500),
  holidays boolean not null default true,
  reviews_to_posts boolean not null default true,
  telegram_chat text check (telegram_chat is null or char_length(telegram_chat) <= 120),
  last_planned_for date,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.social_autopilot enable row level security;
drop policy if exists social_autopilot_read on public.social_autopilot;
create policy social_autopilot_read on public.social_autopilot for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists social_autopilot_write on public.social_autopilot;
create policy social_autopilot_write on public.social_autopilot for all to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage'))
  with check (public.has_permission(organization_id, 'campaigns.manage'));
grant select, insert, update on public.social_autopilot to authenticated;

-- ------------------------------------------------------------ what the brain learned ----
create table if not exists public.social_brain (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  learned jsonb not null default '{}'::jsonb check (jsonb_typeof(learned) = 'object'),
  posts_analyzed int not null default 0,
  learned_at timestamptz not null default now()
);
alter table public.social_brain enable row level security;
drop policy if exists social_brain_read on public.social_brain;
create policy social_brain_read on public.social_brain for select to authenticated
  using (public.is_org_member(organization_id));
revoke insert, update, delete on public.social_brain from anon, authenticated;
grant select on public.social_brain to authenticated;

-- ------------------------------------------------------------ posts: pillar, origin, engagement ----
alter table public.social_posts add column if not exists pillar text;
alter table public.social_posts add column if not exists origin text;
alter table public.social_posts add column if not exists headline text;
alter table public.social_posts add column if not exists media_pending text;
alter table public.social_posts add column if not exists metrics jsonb not null default '{}'::jsonb;
alter table public.social_posts add column if not exists metrics_at timestamptz;
alter table public.social_posts add column if not exists engagement int;
alter table public.social_posts add column if not exists telegram_chat text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_pillar_check') then
    alter table public.social_posts add constraint social_posts_pillar_check check (pillar is null or char_length(pillar) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_origin_check') then
    alter table public.social_posts add constraint social_posts_origin_check
      check (origin is null or origin in ('autopilot', 'week', 'review', 'repurpose', 'evergreen', 'holiday', 'studio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_headline_check') then
    alter table public.social_posts add constraint social_posts_headline_check check (headline is null or char_length(headline) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_media_pending_check') then
    alter table public.social_posts add constraint social_posts_media_pending_check
      check (media_pending is null or media_pending in ('image', 'video'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_metrics_check') then
    alter table public.social_posts add constraint social_posts_metrics_check check (jsonb_typeof(metrics) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'social_posts_telegram_chat_check') then
    alter table public.social_posts add constraint social_posts_telegram_chat_check check (telegram_chat is null or char_length(telegram_chat) <= 120);
  end if;
end $$;

create index if not exists social_posts_metrics_due on public.social_posts (status, metrics_at) where status in ('published', 'partial');
create index if not exists social_posts_media_pending on public.social_posts (scheduled_at) where media_pending is not null;

-- ------------------------------------------------------------ claim one day for one business (no double posts) ----
create or replace function public.claim_social_autopilot(p_org uuid, p_date date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  update public.social_autopilot
     set last_planned_for = p_date, updated_at = now()
   where organization_id = p_org
     and enabled
     and (last_planned_for is null or last_planned_for < p_date);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.claim_social_autopilot(uuid, date) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.social_autopilot, public.social_brain to service_role';
    execute 'grant execute on function public.claim_social_autopilot(uuid, date) to service_role';
  end if;
end $$;
