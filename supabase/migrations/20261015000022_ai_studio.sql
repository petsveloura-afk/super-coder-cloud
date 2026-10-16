-- ============================================================================
-- SUPER CODER CLOUD — 0022 AI studio upgrade (additive)
--   • persistent agent conversations (survive refresh, long context)
--   • agent tools: site_builder (landing page / full site from the chat), image_gen
--   • AI features: site_builder + image_gen metered in ai_usage
--   • plan features: every plan builds landing pages; paid plans build full sites + AI images
--   • public "site-assets" bucket for generated images (written by the server only)
-- ============================================================================

-- ---------------------------------------------------------------- conversations
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id uuid,
  title text not null default '' check (char_length(title) <= 120),
  channel text not null default 'studio' check (channel in ('studio', 'inbox', 'api')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references public.ai_agents (organization_id, id) on delete cascade
);
create index if not exists ai_conversations_org_agent_idx on public.ai_conversations (organization_id, agent_id, updated_at desc);

create table if not exists public.ai_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 20000),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.ai_conversations (organization_id, id) on delete cascade
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (public.has_permission(organization_id, 'ai.use'));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (public.has_permission(organization_id, 'ai.use') and created_by = auth.uid());
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (public.has_permission(organization_id, 'ai.use')) with check (public.has_permission(organization_id, 'ai.use'));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (public.has_permission(organization_id, 'ai.use') and (created_by = auth.uid() or public.has_permission(organization_id, 'ai.manage')));

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (public.has_permission(organization_id, 'ai.use'));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (public.has_permission(organization_id, 'ai.use'));

grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.ai_conversations, public.ai_messages to service_role;
  end if;
end $$;

-- keep the conversation list ordered by activity
create or replace function public.ai_messages_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ai_conversations
     set updated_at = now(),
         title = case when title = '' and new.role = 'user' then left(btrim(regexp_replace(new.content, '\s+', ' ', 'g')), 80) else title end
   where id = new.conversation_id;
  return null;
end;
$$;
drop trigger if exists ai_messages_touch on public.ai_messages;
create trigger ai_messages_touch after insert on public.ai_messages for each row execute function public.ai_messages_touch();

-- ---------------------------------------------------------------- agent tools
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.ai_agents'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%allowed_tools%'
  loop
    execute format('alter table public.ai_agents drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_agents
  add constraint ai_agents_allowed_tools_check
  check (allowed_tools <@ array['crm_lookup', 'draft_message', 'site_builder', 'image_gen']::text[]);

-- ---------------------------------------------------------------- metered features
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.ai_usage'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%feature%'
  loop
    execute format('alter table public.ai_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.ai_usage
  add constraint ai_usage_feature_check
  check (feature in ('contact_summary', 'followup_draft', 'agent_chat', 'site_builder', 'image_gen'));

-- ---------------------------------------------------------------- plan features
update public.plans set features = array_append(features, 'ai_site_landing')
 where not ('ai_site_landing' = any (features));
update public.plans set features = array_append(features, 'ai_site_full')
 where key in ('pro', 'business', 'enterprise') and not ('ai_site_full' = any (features));
update public.plans set features = array_append(features, 'ai_images')
 where key in ('pro', 'business', 'enterprise') and not ('ai_images' = any (features));

-- ---------------------------------------------------------------- public assets bucket
do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present — skipping site-assets bucket';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('site-assets', 'site-assets', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = true;
  -- members may read their own org's objects through the API; writes are server-side (service role) only
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site assets read') then
    execute $p$
      create policy "site assets read" on storage.objects for select to authenticated
      using (bucket_id = 'site-assets' and public.has_permission(((storage.foldername(name))[1])::uuid, 'websites.manage'))
    $p$;
  end if;
end $$;

notify pgrst, 'reload schema';

-- every existing agent gets the new tools (businesses can switch them off per agent)
update public.ai_agents
   set allowed_tools = array(select distinct t from unnest(allowed_tools || array['site_builder', 'image_gen']::text[]) as t order by t)
 where not (allowed_tools @> array['site_builder', 'image_gen']::text[]);

notify pgrst, 'reload schema';
