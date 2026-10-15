# Database

Postgres (Supabase). Migrations in `supabase/migrations`, applied in filename order.

| Migration | Contents |
|---|---|
| `…0001_extensions_helpers` | pgcrypto, citext, enums (`org_role`, `contact_status`, `deal_status`, `task_status`, `integration_status`), `set_updated_at()` |
| `…0002_tenancy` | `profiles`, `organizations`, `organization_members`, `permissions`, `roles`, `role_permissions`, `platform_admins`, `invitations`; helpers `current_role_in`, `is_org_member`, `has_permission`, `is_platform_admin`, `shares_org_with`, `can_assign_role`; RPCs `create_organization`, `accept_invitation`; triggers `handle_new_user`, `guard_membership_change` |
| `…0003_permissions_seed` | **generated** from `packages/shared/src/permissions.ts` |
| `…0004_crm` | `companies`, `contacts`, `pipelines`, `pipeline_stages`, `deals`, `tasks`, `notes`, `activities`, `tags`, `contact_tags`, `custom_fields` |
| `…0005_platform` | `audit_logs` (append-only), `notifications`, `feature_flags`, `api_keys`, `files`, `integrations`, `integration_credentials`; `audit_row_change` trigger; `dashboard_kpis`, `contacts_daily` |
| `…0006_rls` | RLS on every table, all policies, grants |
| `…0007_storage` | private `org-files` bucket + policies (skipped where no storage schema) |
| `…0008_demo_data` | `load_demo_data(org)` |
| `…0009_audit_events` | `log_event(...)` whitelisted application events |

## Conventions
- Every tenant table: `organization_id uuid not null`, `unique (organization_id, id)`.
- References between tenant rows: composite FK on `(organization_id, <ref>_id)`.
- Policies: `has_permission(organization_id, 'x.read'|'x.write'|'x.delete')`.
- `SECURITY DEFINER` functions always `set search_path = public, pg_temp` and only read `auth.uid()`.
- Text columns have length `check` constraints; phones normalised to `^\+?[0-9]{7,15}$`.
- One contact email per organization (partial unique index) → duplicate detection.

## Changing permissions
Edit `packages/shared/src/permissions.ts`, run `pnpm gen:permissions`, then create a **new** migration that
re-applies the generated statements (never edit an applied migration in production). CI fails if the
generated file differs from the committed one.

## Generating full TypeScript types
```bash
npx supabase gen types typescript --local > packages/database/src/supabase.gen.ts
```

## Planned tables (not yet created)
workflows, workflow_versions, workflow_nodes, workflow_executions, workflow_execution_steps, ai_agents,
ai_conversations, ai_messages, knowledge_bases, knowledge_documents, document_chunks (pgvector),
conversations, conversation_messages, inbox_channels, websites, landing_pages, forms, form_submissions,
campaigns, campaign_recipients, appointments, calendars, support_tickets, invoices, subscriptions,
usage_records, webhook_endpoints, webhook_deliveries — added in their phases with the same conventions.
