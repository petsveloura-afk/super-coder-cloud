-- Facebook Messenger / Instagram Direct: faster answers (additive, idempotent).
-- Indexes only — no table, column, function or policy is created, changed or dropped, and no data is touched.
-- Every statement is "if not exists": safe to run twice, safe next to any other wave.

-- 1) The Meta webhook finds the business by Page id / Instagram id on every single message.
create index if not exists channel_accounts_meta_page_idx
  on public.channel_accounts (kind, (config ->> 'page_id'))
  where kind = 'messenger';

create index if not exists channel_accounts_meta_ig_idx
  on public.channel_accounts (kind, (config ->> 'ig_id'))
  where kind = 'instagram';

-- 2) "Does this business have an enabled agent?" / "which agent answers this channel?" (webhook + autopilot).
create index if not exists ai_agents_org_enabled_idx
  on public.ai_agents (organization_id, created_at)
  where enabled;

-- 3) The agent's hot queries: the latest incoming / outgoing message of a conversation.
create index if not exists messages_conv_dir_created_idx
  on public.messages (conversation_id, direction, created_at desc);

notify pgrst, 'reload schema';
