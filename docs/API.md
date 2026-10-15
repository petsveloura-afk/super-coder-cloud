# API

Phase 1 exposes a small, session-authenticated surface. The public, API-key-authenticated REST API
(`/api/v1/*` with `api_keys`) and webhooks are Phase 3.

## `GET /api/health`
No auth. Returns liveness and **booleans only** (never secret values).
```json
{ "status": "ok", "version": "a1b2c3d", "supabaseConfigured": true,
  "integrations": { "openai": false, "anthropic": false, "telegram": false, "whatsapp": false,
                    "email": false, "sms": false, "payments": false, "queue": false },
  "time": "2026-10-15T07:20:46.047Z" }
```

## `GET /api/v1/contacts/export?org=<uuid>`
Auth: Supabase session cookie. Requires `contacts.export` in that organization.
| Status | Meaning |
|---|---|
| 200 | `text/csv; charset=utf-8` with BOM, formula-injection safe |
| 400 | `org` missing or not a UUID |
| 401 | not signed in |
| 403 | not a member, or role lacks `contacts.export` |

Columns: `first_name,last_name,email,phone,company_name,job_title,status,source,marketing_consent,created_at`.
Each export writes an audit event `contacts.exported`.

## `GET /auth/confirm`
Supabase email-link / OAuth callback. Params: `token_hash`+`type` or `code`, and `next` (same-origin path only).

## Database RPCs callable by signed-in users (via PostgREST)
| RPC | Purpose |
|---|---|
| `create_organization(p_name, p_slug, p_locale, p_timezone, p_currency)` | create org, caller = owner |
| `accept_invitation(p_token)` | join org with a raw invitation token |
| `load_demo_data(org)` | fictional data into an empty org (`settings.manage`) |
| `dashboard_kpis(org, since)`, `contacts_daily(org, days)` | RLS-respecting metrics |
| `log_event(p_org, p_action, p_entity_type, p_entity_id, p_metadata)` | whitelisted audit events |
| `has_permission(org, perm)`, `is_org_member(org)`, `current_role_in(org)`, `is_platform_admin()` | introspection for the current user only |
