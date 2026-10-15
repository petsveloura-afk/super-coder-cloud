# Administrator guide

## Roles and permissions
Source of truth: `packages/shared/src/permissions.ts`.

| Role | Highlights |
|---|---|
| agency_owner / owner | everything, incl. `org.delete`, `billing.manage` |
| admin | everything except `org.delete`, `billing.manage` |
| manager | CRM read/write/delete, export, invite members, audit log |
| marketing | read all, write contacts/companies, export |
| sales | read all, write contacts/companies/deals/tasks |
| support | read all, write contacts/tasks |
| analyst | read all, export, audit log |
| client | read CRM only (portal use) |
| read_only | read all CRM + analytics |

## Platform Super Admin
Granted only via SQL (`scripts/setup/create-platform-admin.sql`). It shows a badge in the user menu and is the
gate for the future admin console. It does **not** give access to tenants' data through RLS.

## Operational tasks
| Task | How |
|---|---|
| Remove a user from a workspace | Team page → ✕ (or SQL `delete from organization_members ...` with service role) |
| Recover a workspace with no owner | Impossible by design via the app; via SQL as service role: `update organization_members set role='owner' where ...` |
| Inspect audit trail | Settings → Audit log, or `select * from audit_logs where organization_id = ... order by created_at desc` |
| Toggle a global feature flag | `update feature_flags set enabled = true where key = '...' and organization_id is null` |
| Purge stale invitations/notifications | runs automatically in `apps/worker`; once: `WORKER_ONCE=true pnpm worker` |

## Backups
Supabase Pro plans include daily backups and PITR (add-on). Export a manual dump:
```bash
npx supabase db dump --linked -f backup.sql
```
