# Commercial layer (v2) — plans, payments, AI, keep-alive, sync

## Plans (table `plans`, editable)
| Plan | ₪/month | ₪/year | Contacts | Members* | AI credits/month | AI agents |
|---|---|---|---|---|---|---|
| Free | 0 | 0 | 250 | 2 | 50 | 1 |
| Pro | 149 | 1,490 | 5,000 | 5 | 1,000 | 3 |
| Business | 399 | 3,990 | 50,000 | 25 | 10,000 | 20 |
| Enterprise | custom | custom | ∞ | ∞ | ∞ | ∞ |

\* members include pending invitations. Prices are a starting proposal — change them with SQL:
```sql
update public.plans set price_monthly = 199, limits = limits || '{"contacts": 10000}' where key = 'pro';
```

**Limits are enforced inside Postgres** (triggers on contacts / invitations / members / ai_agents and in
`reserve_ai_credits`), so no client or API path can bypass them. Users see a translated "upgrade" message.

## Payments
- Provider abstraction: `apps/web/lib/billing/stripe.ts` (REST, no SDK). Card data never touches our servers
  (Stripe Checkout + Customer Portal).
- Webhook: `POST /api/webhooks/stripe` — HMAC signature with 5-minute replay window, idempotent
  (`billing_events`), and the plan is only ever changed by `apply_subscription()` (service role).
- **Israel:** Stripe's availability for businesses registered in Israel has been limited; check before
  committing. Alternatives with Israeli clearing (e.g. local gateways, or a foreign entity with Stripe) can be
  added as another adapter with the same webhook → `apply_subscription()` contract. Tax invoices
  (חשבונית מס) must come from a licensed Israeli invoicing provider — not included; consult your accountant.
- Manual plan (bank transfer / invoice): `select public.admin_set_plan('<org-id>', 'pro');` as a platform admin.

### Stripe setup (when available)
1. Create products "Pro" and "Business", each with a monthly and a yearly price (ILS).
2. Webhook endpoint: `https://<your-domain>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
3. Set in Vercel: `PAYMENT_PROVIDER_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, the four `STRIPE_PRICE_*`. Redeploy.

## AI
- Providers: Anthropic and OpenAI (`apps/web/lib/ai/providers.ts`), keys server-only.
- Every call: `reserve_ai_credits` (permission `ai.use`, demo-workspace block, 20 req/min rate limit, monthly
  credit cap) → provider → `finalize_ai_usage` (1 credit per started 1,000 tokens; failures cost 0).
- Prompt-injection hygiene: CRM data is wrapped in `<crm_data>` with brackets neutralised, and the system
  prompt forbids following instructions found inside it.
- Features: contact summary, follow-up draft (respects marketing consent), AI agent studio with test chat and
  an RLS-scoped CRM lookup tool. AI output is labelled "AI-generated — review before use" and is never saved
  automatically.

## Keep-alive (Supabase Free pauses after ~7 idle days)
Two independent daily heartbeats run a real DB round-trip through `GET /api/keepalive` (`public.ping()`):
1. Vercel Cron (`apps/web/vercel.json`, 05:00 UTC) — sends `CRON_SECRET` automatically.
2. GitHub Actions `keepalive.yml` (04:23 UTC) — set repo secrets `CRON_SECRET` (same value) and optionally `APP_URL`.
This is ordinary light usage; it does not affect data or quotas in any meaningful way.

## Backups
`db-backup.yml` runs weekly: schema + data dump, AES-256 encrypted with `BACKUP_PASSPHRASE`, kept 30 days as a
private artifact. Restore instructions are at the top of the workflow file.

## Full sync
`git push` (or `sync.cmd "message"` on Windows) → **CI** → **Deploy database migrations** →
**Sync production (Vercel)** → health check. Needs repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID` (the last two are in `.vercel/project.json` after `npx vercel link`).

## v3 — activation ("paste keys and go")
Run **`setup.cmd`** (Windows, from the project folder) or `node scripts/setup/configure.mjs`. It:
1. checks the folder is linked to Vercel (`.vercel/project.json`) and you are logged in (`npx vercel login`);
2. asks for the keys — input hidden, Enter skips an optional one, existing values are kept:
   `SUPABASE_SERVICE_ROLE_KEY` (required, `sb_secret_…`), `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`,
   `EMAIL_PROVIDER_API_KEY` (Resend `re_…`) + `EMAIL_FROM_ADDRESS`, `VERCEL_TOKEN`, `SUPABASE_DB_URL`;
3. generates `CRON_SECRET` (every run, written to Vercel **and** GitHub so they always match) and
   `ENCRYPTION_KEY` (only if missing — never rotated automatically);
4. writes Vercel Production variables; writes GitHub secrets with the GitHub CLI (`gh`) when installed and
   logged in — otherwise prints the exact name/value pairs to paste; `BACKUP_PASSPHRASE` is shown once — save it;
5. deploys to production and verifies `/api/health` + `/api/keepalive` (which now also runs maintenance).
Safe to run again at any time (e.g. to add an AI key later).

## Daily maintenance (no separate worker host)
`public.run_maintenance()` (migration 0013, service role only) runs from the same daily Vercel Cron call to
`/api/keepalive` when `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are set: purges invitations expired > 30
days, read notifications > 90 days, rate-limit windows > 2 days, and releases AI reservations stuck in
`pending` > 1 hour (credits 0). Idempotent. The response reports `maintenance: ran | skipped | failed`.

## Email
- Team invitations are emailed automatically (he/ar RTL, en LTR, all values HTML-escaped) via Resend's REST
  API when `EMAIL_PROVIDER_API_KEY` + `EMAIL_FROM_ADDRESS` are set. The link is still shown once as a backup.
- Signup / password-reset emails are sent by **Supabase Auth**: Authentication → Emails → SMTP Settings →
  custom SMTP `smtp.resend.com`, port `465`, user `resend`, password = the Resend key. Verify your sending
  domain in Resend first. Without custom SMTP Supabase's built-in sender is heavily rate-limited.

## Speed
- Vercel functions run in **bom1 (Mumbai)**, next to the Supabase database (ap-south-1) — `apps/web/vercel.json`.
  If you move the database, change the region to match.
- Session checks use `auth.getClaims()` (local JWT signature verification with Supabase's asymmetric keys)
  instead of a network round-trip to Supabase Auth on every request.

## v4 — Automations, API, webhooks, channels
- **Automations** (`/automations`): event outbox in Postgres → rules run instantly (internal actions) →
  external actions (e-mail, webhook, WhatsApp, Telegram, SMS, delayed actions) go to `jobs` and are sent by
  `/api/jobs/dispatch` right after the user's action, every 5 minutes by `.github/workflows/jobs.yml`, and daily
  by Vercel Cron. Retries with exponential backoff; dead-letter after 6 attempts.
- **Public API** (`/api/public/v1/*`): Bearer API keys created in Integrations (shown once, SHA-256 stored),
  scopes per key, 120 req/min. Endpoints: me, contacts (list/upsert/get/patch), deals, tasks, events.
- **Outgoing webhooks**: `X-SCC-Signature: sha256=HMAC(secret, timestamp + "." + body)`, `X-SCC-Timestamp`,
  `X-SCC-Event`, `X-SCC-Delivery`. Only public https targets (SSRF guard).
- **Channels** (Integrations → Messaging channels): Telegram (paste the BotFather token — webhook is set
  automatically), WhatsApp Cloud API (phone number id + permanent token + app secret; paste the callback URL
  and verify token in Meta), Twilio SMS (SID + auth token + sender; paste the callback URL in Twilio).
  Credentials are encrypted with `ENCRYPTION_KEY` (generated by setup.cmd).
