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
