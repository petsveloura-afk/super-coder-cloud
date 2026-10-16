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

## v3 additions
| Variable | Required | Scope | Used by | Where to get it |
|---|---|---|---|---|
| `EMAIL_PROVIDER_API_KEY` + `EMAIL_FROM_ADDRESS` | for email | **server** | team invitation emails (Resend REST) | resend.com → API Keys (`re_…`); sender on a verified domain |
| `EMAIL_PROVIDER_API_BASE` | no | server | override the Resend endpoint (tests / proxy) | default `https://api.resend.com` |
| `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` | for maintenance | **server** | daily `run_maintenance()` via `/api/keepalive` | Supabase → Project Settings → API Keys → Secret key |

All of the above can be written for you by `setup.cmd` (see docs/COMMERCIAL.md → "v3 — activation").

## v4 wave 4 additions
No new environment variables. Online invoice payments use **each organization's own Stripe keys**, entered in *Finance → Settings* and stored encrypted with `ENCRYPTION_KEY` (must be set). Each organization gets its own webhook URL: `/api/webhooks/payments/{token}` (event `checkout.session.completed`). `PAYMENT_PROVIDER_API_BASE` (tests only) also redirects these calls.

## AI: Google Gemini (free tier)
| Variable | Required | Where | Purpose | Get it |
|---|---|---|---|---|
| `GEMINI_API_KEY` | no | **server** | AI assistant + agents via Google Gemini (has a free tier) | aistudio.google.com → Get API key |
| `AI_GEMINI_MODEL` | no | server | default Gemini model (default `gemini-2.5-flash`) | model id from Google |
| `AI_GEMINI_BASE_URL` | no | server | tests / gateways only | — |

Any one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` enables AI. When several are set, agents use the provider chosen per agent; the default order is Anthropic → OpenAI → Gemini.

### Several Gemini keys (more free quota)
Add extra keys in Vercel → Environment Variables as `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` … `GEMINI_API_KEY_10` (or all of them comma-separated in `GEMINI_API_KEYS`). Each request starts at a random key and moves to the next key when Google answers "busy"/"quota" (429/5xx); retired or busy models fall back along `AI_GEMINI_FALLBACK_MODELS` (default `gemini-flash-latest,gemini-3.8-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite`). At most 6 calls per request.

### AI website builder + AI images (wave 5)
| Variable | Required | Where | Purpose |
|---|---|---|---|
| `AI_GEMINI_IMAGE_MODELS` | no | server | comma list of Gemini image models, tried in order (default `gemini-3.1-flash-image,gemini-2.5-flash-image,gemini-3.1-flash-lite-image`) |

- AI images need a Gemini key **and** `SUPABASE_SERVICE_ROLE_KEY` (images are saved to the public Storage bucket `site-assets`, created by migration `20261015000022_ai_studio.sql`).
- Plan gating (table `plans.features`): `ai_site_landing` on every plan; `ai_site_full` and `ai_images` on pro / business / enterprise only. A full-site request on the free plan is built as a landing page.
- Image generation may not be included in Google's free tier. If it fails, the site is still built — just without the AI image.
- Every AI site is saved as a **draft**; the owner previews it (`/{lang}/websites/{id}/preview`) and publishes it manually.
