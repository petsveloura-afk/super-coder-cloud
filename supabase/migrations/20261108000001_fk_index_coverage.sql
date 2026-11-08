-- Wave 2 (performance): indexes for foreign keys that had none.
--
-- WHY: when a parent row is deleted (a campaign, a team task, a calendar connection, an AI agent, a contact, a deal ...) Postgres
-- checks every child table that points to it. Without an index on the pointing column that check reads the WHOLE child table
-- — for each deleted row. Several of these tables are the biggest in the system (messages, conversations, jobs).
-- Each column below was verified in two ways: (1) against the full migration chain in a real Postgres (no index whose leading
-- column serves the foreign key), (2) in the code (the parent is deleted by an existing action, or the column is filtered on).
--
-- SAFETY: additive only (create index if not exists). No table, column, policy or data is touched, so there is no new RLS to write
-- (RLS lives on the tables and is unchanged). Partial indexes (`where col is not null`) skip the rows that point to nothing, so they stay
-- small and add no write cost to rows that never set the column. Postgres uses a partial index for the foreign-key check because
-- `col = value` implies `col is not null`.
-- NOTE: a plain `create index` blocks writes to that one table while it builds (seconds on normal data sizes).

-- 1) the candidates reported from the previous review
create index if not exists jobs_campaign_recipient_idx on public.jobs (campaign_recipient_id) where campaign_recipient_id is not null;
create index if not exists team_tasks_parent_idx on public.team_tasks (parent_id) where parent_id is not null;
create index if not exists team_tasks_merged_into_idx on public.team_tasks (merged_into) where merged_into is not null;
-- also serves the runner's "pending approvals of this task" count (task_id + status)
create index if not exists team_approvals_task_idx on public.team_approvals (task_id, status) where task_id is not null;
-- the calendar sync deletes and re-inserts a connection's busy times on every refresh
create index if not exists calendar_busy_connection_idx on public.calendar_busy (connection_id);

-- 2) found while verifying: the contact / deal / automation / webhook / AI agent delete paths
-- conversations: also serves "this customer's chats, newest first" (reminders, follow-ups)
create index if not exists conversations_contact_idx on public.conversations (organization_id, contact_id, last_message_at desc nulls last) where contact_id is not null;
create index if not exists conversations_deal_idx on public.conversations (organization_id, deal_id) where deal_id is not null;
-- messages sent by an AI agent (deleting an agent used to read the whole messages table)
create index if not exists messages_ai_agent_idx on public.messages (organization_id, ai_agent_id) where ai_agent_id is not null;
create index if not exists jobs_automation_idx on public.jobs (organization_id, automation_id) where automation_id is not null;
create index if not exists jobs_webhook_idx on public.jobs (organization_id, webhook_id) where webhook_id is not null;
create index if not exists automation_runs_automation_idx on public.automation_runs (automation_id);
create index if not exists activities_deal_idx on public.activities (organization_id, deal_id) where deal_id is not null;
create index if not exists notes_deal_idx on public.notes (organization_id, deal_id) where deal_id is not null;
create index if not exists tasks_deal_idx on public.tasks (organization_id, deal_id) where deal_id is not null;
create index if not exists tasks_contact_idx on public.tasks (organization_id, contact_id) where contact_id is not null;
create index if not exists deals_contact_idx on public.deals (organization_id, contact_id) where contact_id is not null;
create index if not exists deals_company_idx on public.deals (organization_id, company_id) where company_id is not null;
create index if not exists appointments_contact_idx on public.appointments (organization_id, contact_id) where contact_id is not null;
create index if not exists appointments_type_idx on public.appointments (organization_id, type_id) where type_id is not null;
create index if not exists ai_usage_agent_idx on public.ai_usage (organization_id, agent_id) where agent_id is not null;
create index if not exists documents_contact_idx on public.documents (organization_id, contact_id) where contact_id is not null;
create index if not exists documents_deal_idx on public.documents (organization_id, deal_id) where deal_id is not null;
create index if not exists documents_company_idx on public.documents (organization_id, company_id) where company_id is not null;
create index if not exists tickets_contact_idx on public.tickets (organization_id, contact_id) where contact_id is not null;
create index if not exists files_contact_idx on public.files (organization_id, contact_id) where contact_id is not null;
