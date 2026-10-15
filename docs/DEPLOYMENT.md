# Deployment — GitHub + Vercel + Supabase

## 1. Supabase project
1. https://supabase.com/dashboard → **New project** (region: `eu-central-1` Frankfurt is closest to Israel).
2. Save the **database password**.
3. Project Settings → API: copy **Project URL**, **anon public key**, **service_role key**.
4. Authentication → URL Configuration:
   - Site URL: `https://app.yourdomain.com`
   - Redirect URLs: `https://app.yourdomain.com/auth/confirm`
5. Authentication → Providers → Email: **keep "Confirm email" ON** in production. Minimum password length 10.
6. (Optional) Google provider: add client id/secret, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
7. Configure custom SMTP (Authentication → SMTP) — the built-in sender is rate limited.

## 2. Apply migrations
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase migration list
npx supabase db push
```
Verify in SQL editor:
```sql
select count(*) from pg_policies where schemaname = 'public';      -- 76
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity; -- 0 rows
```

## 3. GitHub
```bash
git init && git add . && git commit -m "Super Coder Cloud — phase 1"
git branch -M main
git remote add origin git@github.com:<you>/super-coder-cloud.git
git push -u origin main
```
Repository secret for `.github/workflows/deploy.yml`: `SUPABASE_DB_URL` — Supabase → **Connect** →
**Direct** → **Session pooler** connection string with your database password filled in
(`postgresql://postgres.<ref>:<PASSWORD>@aws-…pooler.supabase.com:5432/postgres`). Use the pooler, not the
direct `db.<ref>.supabase.co` host (IPv6-only; GitHub runners are IPv4). URL-encode special characters in the
password, or reset it to letters/digits only. No access token is required. Without the secret the workflow
skips with a warning. A GitHub Environment named `production` is created automatically on first run (add
required reviewers if desired).

## 4. Vercel
1. https://vercel.com/new → import the repository.
2. **Root Directory: `apps/web`** (Vercel detects the pnpm workspace and installs from the repo root).
3. Framework: Next.js (auto). Node.js: 22.x.
4. Environment Variables (Production + Preview):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://app.yourdomain.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**server only**) |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 24` |

5. Deploy. Then:
```bash
curl -s https://app.yourdomain.com/api/health
# {"status":"ok","supabaseConfigured":true,...}
```

## 5. Custom domain
Vercel → Project → Settings → Domains → add `app.yourdomain.com`, create the CNAME it shows
(`cname.vercel-dns.com`). Update `NEXT_PUBLIC_APP_URL` and Supabase Site URL/Redirect URLs to match, then redeploy.

## 6. Worker (separate host)
```bash
docker build -f apps/worker/Dockerfile -t scc-worker .
docker run -e DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" scc-worker
```
Railway/Render/Fly: point to the repo, Dockerfile `apps/worker/Dockerfile`, set `DATABASE_URL`
(Supabase → Connect → Session pooler). Cron-style alternative: `WORKER_ONCE=true` on a scheduled job.

## 7. First administrator
Sign up through the app, then in the Supabase SQL editor:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('you@yourdomain.com');
```

## 8. Webhooks
No inbound webhooks exist in Phase 1. From Phase 3 they will live under `/api/webhooks/<provider>` and verify
signatures with `verifyHmacSignature` (`packages/shared/src/crypto.ts`).

## 9. Production verification checklist
```bash
pnpm check:env --prod        # with production values exported in your shell
```
- [ ] Sign up receives a confirmation email; link lands on `/he/onboarding`.
- [ ] Password reset email works.
- [ ] Two separate accounts cannot see each other's contacts (open a contact URL from account A in account B → 404).
- [ ] `/api/health` → `supabaseConfigured: true`.
- [ ] Response headers include `Content-Security-Policy` and `Strict-Transport-Security`.
- [ ] Open on iPhone Safari; add to Home Screen; app opens standalone.

## 10. Monitoring
Vercel → Observability (function errors, latency). Supabase → Logs (Auth, Postgres, API) and Reports.
Recommended next step: add Sentry (`@sentry/nextjs`) — not included in Phase 1.

## 11. Full automatic sync without connecting Vercel to GitHub
`.github/workflows/sync-production.yml` chains the pipeline on every push to `main`:

```
git push → CI → Deploy database migrations (Supabase) → Sync production (Vercel) → health check
```

One-time setup — repository secrets (Settings → Secrets and variables → Actions):

| Secret | Where |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Connect → Direct → Session pooler (password filled in, URL-encoded) |
| `VERCEL_TOKEN` | vercel.com (project owner's account) → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | `"orgId"` in `.vercel/project.json` (Windows: `type .vercel\project.json`) |
| `VERCEL_PROJECT_ID` | `"projectId"` in `.vercel/project.json` |

Run it manually any time: Actions → **Sync production (Vercel)** → Run workflow.
Missing secrets make the job skip with a warning rather than fail.
