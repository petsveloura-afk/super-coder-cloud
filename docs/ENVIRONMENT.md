# Environment variables

Validate at any time: `pnpm check:env` (local) · `pnpm check:env --prod` (production rules). The checker
never prints values. Any variable starting with `NEXT_PUBLIC_` is embedded in browser JavaScript —
**never put a secret there** (enforced by ESLint, a unit test and the checker).

| Variable | Required | Scope | Used by | Where to get it | Validation |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | public | auth redirects, invite links | your domain | valid URL; https in prod |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | public | all data access | Supabase → Settings → API | valid URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | public | all data access (RLS-bound) | Supabase → Settings → API | non-empty |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | no | public | login/signup Google button | set `true` after configuring Google in Supabase | `true`/`false` |
| `SUPABASE_SERVICE_ROLE_KEY` | prod | **server** | `lib/supabase/admin.ts` (Phase 3+: webhooks, jobs) | Supabase → Settings → API | non-empty |
| `DATABASE_URL` | worker | **server** | `apps/worker` | Supabase → Connect → Session pooler | Postgres URL |
| `ENCRYPTION_KEY` | prod | **server** | AES-256-GCM for integration credentials | `openssl rand -hex 32` | 64 hex chars |
| `CRON_SECRET` | prod | **server** | scheduled endpoints (Phase 3) | `openssl rand -hex 24` | non-empty |
| `DEMO_MODE` | no | server | global demo safety switch | — | `true`/`false` |
| `OPENAI_API_KEY` | no | server | AI (Phase 4) | platform.openai.com | — |
| `ANTHROPIC_API_KEY` | no | server | AI (Phase 4) | console.anthropic.com | — |
| `TELEGRAM_BOT_TOKEN` | no | server | Telegram (Phase 5) | @BotFather | — |
| `META_APP_ID`, `META_APP_SECRET` | no | server | Meta/Instagram (Phase 5) | developers.facebook.com | — |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | no | server | WhatsApp Cloud API (Phase 5) | Meta Business → WhatsApp | both required together |
| `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` | no | server | email delivery (Phase 5) | Resend / Postmark / SES | both required |
| `SMS_PROVIDER_API_KEY` | no | server | SMS (Phase 5) | provider dashboard | — |
| `PAYMENT_PROVIDER_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` | no | server | billing (Phase 6) | Stripe dashboard | both required |
| `QUEUE_PROVIDER_URL`, `QUEUE_PROVIDER_TOKEN` | no | server | job queue (Phase 3) | e.g. Upstash QStash | both required |
| `WORKER_INTERVAL_MS` | no | worker | job interval | — | integer ms |
| `WORKER_ONCE` | no | worker | run once and exit | — | `true`/`false` |
| `DATABASE_ADMIN_URL` | tests | dev/CI | RLS test harness | local Postgres with CREATEDB | Postgres URL |
| `E2E_BASE_URL` | tests | dev/CI | Playwright | — | URL |

Missing optional credentials disable the integration: `integrationAvailability()` in
`packages/shared/src/env.ts`, reported as booleans at `/api/health`.

## v2 — commercial layer

| Variable | Required | Scope | Used by | Where to get it |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | for AI | **server** | AI assistant + agents | console.anthropic.com / platform.openai.com — at least one enables AI |
| `AI_ANTHROPIC_MODEL`, `AI_OPENAI_MODEL` | no | server | default model per provider | model id from the provider |
| `PAYMENT_PROVIDER_SECRET_KEY` | for payments | **server** | Stripe Checkout / Portal | Stripe → Developers → API keys (`sk_live_…`) |
| `PAYMENT_WEBHOOK_SECRET` | for payments | **server** | `/api/webhooks/stripe` signature check | Stripe → Developers → Webhooks → endpoint → Signing secret (`whsec_…`) |
| `STRIPE_PRICE_{PRO,BUSINESS}_{MONTH,YEAR}` | for payments | server | maps plans ↔ Stripe prices | Stripe → Products → price id |
| `NEXT_PUBLIC_SALES_EMAIL` | no | public | Enterprise "Talk to us" button | your sales address |
| `CRON_SECRET` | recommended | **server** | protects `/api/keepalive` (Vercel Cron sends it automatically) | `openssl rand -hex 24` |

Without payment variables the billing page still works (plans, usage, limits) and shows "online payments not enabled"; a platform admin can assign plans manually with `select public.admin_set_plan('<org-id>', 'pro');` in the Supabase SQL editor.
