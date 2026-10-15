# Security

## Controls in place (Phase 1)
| Area | Control | Where | Tested |
|---|---|---|---|
| Tenant isolation | RLS on every table, `has_permission()` | migrations 0002/0006 | `packages/database/tests/rls.test.ts`, E2E |
| Cross-tenant references | composite FKs `(organization_id, id)` | 0004/0005 | RLS test |
| IDOR | detail pages filter by id **and** server-resolved org; RLS hides foreign rows | crm/[id] | E2E (other tenant → 404) |
| Privilege escalation | membership guard trigger, `can_assign_role`, `assignableRoles` | 0002, shared | RLS + unit |
| Protected org columns | `guard_org_columns` (plan, parent, created_by) | 0006 | RLS test |
| Secrets at rest | AES-256-GCM (`encryptSecret`), credentials table has no client policy | shared/crypto, 0005 | unit + RLS |
| API keys | only SHA-256 hash stored; prefix for display | shared/crypto, 0005 | unit |
| Webhook signatures | HMAC-SHA256, constant-time compare | shared/crypto | unit |
| Invitations | 256-bit token, hash stored, single-use, 7-day expiry, email-bound | team/actions, 0002 | RLS + E2E |
| Audit trail | append-only `audit_logs`, row triggers, `log_event` whitelist | 0005, 0009 | RLS test |
| Input validation | Zod on every action; DB `check` constraints | shared/validators | unit |
| Output encoding | React escaping; i18n params inserted as text | — | — |
| XSS / clickjacking | CSP (`default-src 'self'`, `frame-ancestors 'none'`), X-Frame-Options DENY | next.config.ts | header smoke test |
| Transport | HSTS 2 years, preload | next.config.ts | header smoke test |
| Open redirect | `safeRedirectPath` (rejects `//`, `/\`, absolute) | lib/env | unit |
| SQL/filter injection | parameterised queries; search sanitised before PostgREST `or()` | lib/search | unit |
| CSV injection | `csvCell` prefixes `= + - @` | lib/format | unit + E2E |
| User enumeration | identical reset-password response | auth/actions | — |
| Sessions | Supabase SSR cookies (httpOnly, SameSite), `getUser()` validated with Auth server | proxy, lib/auth | E2E |
| CSRF | Server Actions enforce same-origin (Next.js Origin check); cookies SameSite=Lax | Next.js | — |
| Service-role isolation | only `lib/supabase/admin.ts` (server-only); static test bans it in client files | — | unit |
| Secret leakage | ESLint rule + unit test + `check:env` reject secret `NEXT_PUBLIC_*` | — | unit |
| Storage | private bucket, path must start with org id, MIME + 25 MB limits | 0007, files table | **not tested** (no storage locally) |
| PWA cache | SW never caches HTML/API/Supabase responses | public/sw.js | review |
| Dependencies | `pnpm audit --prod` (0 known), weekly CI audit, gitleaks | security.yml | audit run |

## Known gaps (tracked in BUILD_STATUS.md)
- No application-level rate limiting yet (Supabase Auth limits apply). Planned: Upstash Redis in Phase 3.
- `script-src 'unsafe-inline'` is required by Next.js without nonces; move to nonce-based CSP later.
- Credential rotation is manual: decrypt with old key, re-encrypt with new `ENCRYPTION_KEY`, deploy.
- No SSRF surface exists yet (no user-defined outbound URLs); Phase 3 webhook actions must use an allow-list
  and block private IP ranges.

## Reporting
security@supercoder.agency
