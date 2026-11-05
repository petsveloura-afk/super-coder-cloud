-- AI video for posts (additive).
--   1. ai_usage may record the feature 'video_gen' (the allowed list is the same list + one value)
--   2. reserve_ai_credits_bulk / finalize_ai_usage_bulk — one usage row worth N credits (a short video costs more than a
--      text call); a failed or cancelled generation costs nothing and a credit taken from a purchased pack is given back
--   3. social_video_jobs — a video takes 30 s – 3 min at the provider: the job is stored, advanced by the screen and by the
--      social clock, and the finished clip is stored in the business's own media folder
-- Nothing existing is removed or changed in behaviour.

-- ------------------------------------------------------------------ 1. the feature list (superset)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.ai_usage'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%feature%' loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in (
  'contact_summary', 'followup_draft', 'agent_chat', 'site_builder', 'image_gen', 'autopilot',
  'insights', 'copilot', 'segment', 'site_copy', 'vision', 'transcribe', 'voice', 'kb', 'forecast', 'ab_variant',
  'social', 'marketing', 'sales_manager', 'brief', 'collections', 'review_reply',
  -- AI video (this migration)
  'video_gen'));

-- ------------------------------------------------------------------ 2. N credits in one reservation
create or replace function public.reserve_ai_credits_bulk(p_org uuid, p_feature text, p_credits int, p_agent uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lim bigint;
  usage_id bigint;
  demo boolean;
  n int := greatest(1, least(coalesce(p_credits, 1), 500));
  used bigint;
  from_pack int := 0;
begin
  select is_demo into demo from public.organizations where id = p_org;
  if demo is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if demo then
    raise exception 'demo_mode' using errcode = 'P0001';
  end if;
  if not public.public_rate_limit('ai-bulk:' || p_org::text, 20, 60) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  lim := public.plan_limit(p_org, 'ai_credits_monthly');
  used := public.ai_credits_used(p_org);
  -- what the monthly allowance does not cover comes from a purchased pack
  if lim is not null and used + n > lim then
    from_pack := least(n, (used + n - lim))::int;
    if public.ai_credit_balance(p_org) < from_pack then
      raise exception 'plan_limit:ai_credits' using errcode = 'P0001', hint = 'upgrade';
    end if;
  end if;
  insert into public.ai_usage (organization_id, user_id, agent_id, feature, credits, status)
  values (p_org, null, p_agent, p_feature, n, 'pending')
  returning id into usage_id;
  if from_pack > 0 then
    insert into public.credit_ledger (organization_id, kind, delta, reason, usage_id)
    values (p_org, 'ai', -from_pack, 'usage', usage_id);
  end if;
  return usage_id;
end;
$$;
revoke all on function public.reserve_ai_credits_bulk(uuid, text, int, uuid) from public, anon, authenticated;

create or replace function public.finalize_ai_usage_bulk(p_usage_id bigint, p_provider text, p_model text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u public.ai_usage;
  taken bigint;
begin
  select * into u from public.ai_usage where id = p_usage_id and user_id is null and status = 'pending' for update;
  if not found then return; end if;
  update public.ai_usage
     set provider = left(coalesce(p_provider, ''), 40),
         model = left(coalesce(p_model, ''), 80),
         credits = case when p_ok then u.credits else 0 end,
         status = case when p_ok then 'ok' else 'error' end
   where id = u.id;
  -- nothing was produced → every credit taken from a purchased pack goes back. The existing refund trigger
  -- (ai_usage_refund_pack) already gave back 1 when the status became 'error'; only the rest is added here, so the
  -- pack ends exactly where it started.
  if not p_ok then
    select coalesce(-sum(delta), 0) into taken from public.credit_ledger where usage_id = u.id and kind = 'ai';
    if taken > 0 then
      insert into public.credit_ledger (organization_id, kind, delta, reason, usage_id)
      values (u.organization_id, 'ai', taken, 'refund', u.id);
    end if;
  end if;
end;
$$;
revoke all on function public.finalize_ai_usage_bulk(bigint, text, text, boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.reserve_ai_credits_bulk(uuid, text, int, uuid) to service_role';
    execute 'grant execute on function public.finalize_ai_usage_bulk(bigint, text, text, boolean) to service_role';
  end if;
end $$;

-- ------------------------------------------------------------------ 3. the jobs
create table if not exists public.social_video_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  request text not null check (char_length(request) between 2 and 2000),
  prompt text not null check (char_length(prompt) between 2 and 4000),
  aspect text not null default '9:16' check (aspect in ('9:16', '16:9', '1:1')),
  seconds int not null default 8 check (seconds between 2 and 20),
  style text check (style is null or char_length(style) <= 30),
  provider text check (provider is null or char_length(provider) <= 30),
  model text check (model is null or char_length(model) <= 120),
  provider_ref jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  video_url text check (video_url is null or (video_url ~ '^https://' and char_length(video_url) <= 1000)),
  poster_url text check (poster_url is null or (poster_url ~ '^https://' and char_length(poster_url) <= 1000)),
  error text check (error is null or char_length(error) <= 500),
  credits int not null default 0 check (credits >= 0),
  usage_id bigint,
  attempts int not null default 0 check (attempts >= 0),
  post_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists social_video_jobs_org_created on public.social_video_jobs (organization_id, created_at desc);
create index if not exists social_video_jobs_open on public.social_video_jobs (status, updated_at) where status in ('queued', 'running');

alter table public.social_video_jobs enable row level security;
drop policy if exists social_video_jobs_read on public.social_video_jobs;
create policy social_video_jobs_read on public.social_video_jobs for select to authenticated
  using (public.has_permission(organization_id, 'campaigns.manage'));
-- writes are server-side only (credits, provider ids): no insert / update / delete for signed-in users
revoke insert, update, delete on public.social_video_jobs from authenticated;
grant select on public.social_video_jobs to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.social_video_jobs to service_role';
  end if;
end $$;
