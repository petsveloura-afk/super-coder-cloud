# Testing

| Suite | Location | Command | Needs |
|---|---|---|---|
| Shared unit (permissions, validators, env, crypto) | `packages/shared/tests` | `pnpm --filter @scc/shared test` | — |
| Web unit + static security (i18n parity, redirects, CSV, search, secret scanning) | `apps/web/tests/unit` | `pnpm --filter @scc/web test` | — |
| RLS / tenant isolation (20 tests) | `packages/database/tests` | `pnpm test:db` | Postgres with CREATEDB |
| Worker jobs | `apps/worker/tests` | `pnpm test:db` | Postgres |
| E2E journeys + iPhone viewport + axe a11y | `apps/web/tests/e2e` | `pnpm test:e2e` | running app + Supabase |

`pnpm test` runs everything except E2E; DB suites are **reported as skipped** (not passed) without
`DATABASE_ADMIN_URL`.

## How DB tests work
`packages/database/tests/harness.ts` creates a throwaway database, applies `supabase/tests/supabase_stub.sql`
(minimal `auth.users`, `auth.uid()`, roles — local only, never on Supabase) and all migrations, then runs each
check inside a transaction as role `authenticated` with `request.jwt.claims` set — exactly how PostgREST
executes requests.

Covered: RLS on all tables; TS↔SQL permission parity; anon denied; cross-tenant read/update/delete/insert;
moving rows between tenants; composite-FK cross-tenant references; read-only role; privilege escalation;
last-owner protection; protected org columns; credentials unreadable; append-only + gated audit log;
RLS-respecting KPIs; invitation binding & single use; manager cannot invite owner; demo loader rules;
duplicate email.

## E2E
```bash
pnpm --filter @scc/web exec playwright install chromium
pnpm --filter @scc/web build && pnpm --filter @scc/web start -p 3000 &
pnpm test:e2e
```
Custom Chromium (images without Playwright browsers): `PW_CHROMIUM_PATH=/path/to/chrome PW_CHROMIUM_ARGS="..."`.
Screenshots of each journey: `E2E_SCREENSHOTS_DIR=/tmp/shots pnpm test:e2e`.
Local Supabase must auto-confirm email (`supabase/config.toml` → `enable_confirmations = false`).

Note: pages under a streaming boundary render "not found" with HTTP 200 once streaming starts; the E2E
asserts the rendered 404 UI rather than the status code.
