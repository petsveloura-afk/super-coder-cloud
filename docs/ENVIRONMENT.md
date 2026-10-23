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

## v6 — AI autopilot: the agent answers customers on every channel
| Variable | Required | Where | Purpose |
|---|---|---|---|
| `META_APP_ID`, `META_APP_SECRET`, `META_WA_CONFIG_ID` | no | server | "Connect WhatsApp" in one click (Meta Embedded Signup). Without them the official card says "coming soon" and the manual connection (Advanced) keeps working |
| `META_WEBHOOK_VERIFY_TOKEN` | with Meta | server | verify token of the app-level webhook `/api/channels/meta/whatsapp` (any random string, ≥ 8 chars) |
| `META_GRAPH_VERSION` | no | server | Graph API version for the new code (default `v25.0`) |
| `WA_BRIDGE_URL`, `WA_BRIDGE_SECRET` | no | server | WhatsApp by QR code through `services/wa-bridge` (always-on, e.g. Railway). Secret ≥ 24 chars, same value on both sides |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | server | "Sign in with Google" for the e-mail channel (redirect `https://<app>/api/oauth/google/callback`) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | no | server | "Sign in with Microsoft" (redirect `https://<app>/api/oauth/microsoft/callback`) |
| `NEXT_PUBLIC_LOCALE_NEGOTIATION` | no | both | empty = Hebrew on a first visit (Arabic browsers get Arabic); `browser` = follow the browser language |

- Website chat: no variables. Shown on every published site and the help portal whenever an enabled agent has "website chat" ticked; embeddable anywhere with `/widget.js`.
- E-mail with an app password works without any variable. Mailboxes are read every 5 minutes by the GitHub "jobs" workflow (`/api/channels/email/poll`), or every minute when the QR bridge runs with `CRON_SECRET`.
- Automatic replies use the workspace's AI credits (feature `autopilot`), at most 30 replies per conversation per hour. A team reply from the inbox switches the conversation to the team; the "Back to AI" button switches it back.
- Full step-by-step setup (Hebrew): `docs/CONNECT_CHANNELS_HE.md`.

## v7 — sales agent
No new variables. `/api/ai/followups` (Bearer `CRON_SECRET`) sends the agent's automatic follow-ups; the GitHub "jobs" workflow calls it every 5 minutes (the QR bridge every minute when it runs with `CRON_SECRET`). New-lead e-mails to the owners use the existing e-mail settings (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`).

## v8 — plan payments, receipts, Telegram personal account, conversation setup
All optional; each payment method appears on the billing page only when its keys are set.

| Variable | Where | Purpose |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Vercel | PayPal REST app (Live). Plans/products are created automatically on the first checkout |
| `PAYPAL_MODE` | Vercel | `live` (default) or `sandbox` |
| `PAYPAL_WEBHOOK_ID` | Vercel | ID of the webhook pointing at `/api/webhooks/paypal` (signature verification) |
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET` | Vercel | Lemon Squeezy checkout + webhook `/api/webhooks/lemonsqueezy` (X-Signature) |
| `LEMONSQUEEZY_VARIANT_{PRO,BUSINESS}_{MONTH,YEAR}` | Vercel | variant id of each plan / interval |
| `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` | Vercel | crypto invoices + IPN `/api/webhooks/nowpayments` (HMAC-SHA512) |
| `BILLING_BUSINESS_NAME`, `_ID`, `_ADDRESS`, `_EMAIL` | Vercel | seller details printed on receipts |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | bridge (Railway) | enables "Telegram personal account" (QR login) on `services/wa-bridge` |
| `AI_AUTOPILOT_PATIENCE_MS` | Vercel | how long an automatic reply waits for a busy AI provider (default 45000) |

Endpoints: `/api/billing/paypal/return` (PayPal approval return), `/api/billing/sweep` (Bearer `CRON_SECRET`, prepaid crypto periods — called by the jobs workflow), `/api/channels/telegram_user/{token}` (signed bridge callbacks).
`/api/ai/followups` now first answers any customer message that got no reply (provider busy / timeout), then sends follow-ups.
Migration: `20261015000025_payments_telegram_user.sql`.

## v9 — AI router (fast failover between AI providers)
Every AI call (agent replies, studio chat, site builder) goes through `lib/ai/router.ts`: the agent's provider first, then `AI_PROVIDER_ORDER` (default `groq,cerebras,gemini,openrouter,mistral,anthropic,openai`). Each key/model is tried once; limited ones rest (shared through table `ai_provider_rests`, migration `20261015000026_ai_router.sql`).

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` (+`_2`…`_10`, `GROQ_API_KEYS`) | Groq (OpenAI-compatible, free tier) |
| `CEREBRAS_API_KEY` (+…) | Cerebras (free tier) |
| `OPENROUTER_API_KEY` (+…) | OpenRouter (`openrouter/free` model) |
| `MISTRAL_API_KEY` (+…) | Mistral (free Experiment plan) |
| `AI_PROVIDER_ORDER` | comma list, e.g. `groq,gemini,cerebras` |
| `AI_GEMINI_MODELS`, `AI_GROQ_MODELS`, `AI_CEREBRAS_MODELS`, `AI_OPENROUTER_MODELS`, `AI_MISTRAL_MODELS` | model lists per provider (first = preferred) |
| `AI_GROQ_BASE_URL`, `AI_CEREBRAS_BASE_URL`, `AI_OPENROUTER_BASE_URL`, `AI_MISTRAL_BASE_URL` | endpoint overrides (gateways / tests) |

Defaults: Gemini `gemini-3.8-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-2.5-flash`; Groq `openai/gpt-oss-120b, llama-3.3-70b-versatile`; Cerebras `gpt-oss-120b, qwen-3.8-27b`; OpenRouter `openrouter/free`; Mistral `mistral-small-latest`.
Platform admin → "AI engines check" probes every key and can clear the rests.

## v10 — Telegram Business + team updates
No new variables. The Telegram webhook now subscribes to `message, edited_message, channel_post, callback_query, business_connection, business_message, edited_business_message, deleted_business_messages` (`TELEGRAM_UPDATES` in `lib/channels/telegram-setup.ts`); existing bots are re-registered automatically by `/api/ai/followups` (cron). Business chats are stored as conversations `telegram` / `biz:<chat id>` with `business_connection_id`. Team updates use table `notify_recipients` (e-mail via `EMAIL_PROVIDER_API_KEY`, Telegram via the org's bot, WhatsApp via QR bridge / Cloud API, SMS via Twilio). Migration: `20261015000027_telegram_business_notify.sql`.

## v11 — PayPal card checkout + router tuning
- Card payments without a PayPal account: one-time PayPal Orders v2 with `landing_page: GUEST_CHECKOUT`, captured on `/api/billing/paypal/order-return` (and by the webhook on `CHECKOUT.ORDER.APPROVED` / `PAYMENT.CAPTURE.COMPLETED`). Prepaid like crypto (`subscriptions.provider_subscription_id = 'order:<id>'`, expired by `sweep_prepaid_subscriptions`, migration `20261015000028_paypal_card_prepaid.sql`). No new variables.
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_MODE` are trimmed. Checkout errors are shown on the billing page (`?error=paypal_auth|paypal_currency|paypal_permission|paypal_request|paypal_down`).
- `AI_ROUTER_PER_PROVIDER` (default 2): max failed calls per provider in one request before moving to the next provider.

## v12 — in-page card form
- Billing page loads the PayPal JS SDK (`https://www.paypal.com/sdk/js`, card funding) inside a dialog; orders are created/captured by server actions (`createCardOrderAction`, `captureCardOrderAction`). CSP for `/:locale/billing` allows PayPal hosts (script/frame/connect/img) and `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
- `PAYPAL_SHOW_SUBSCRIPTION=true` also shows the PayPal recurring-subscription button (hidden by default).
- `PAYPAL_SDK_URL` overrides the SDK URL (tests only).

## Wave 13 — websites, domains, plan features (all optional)
| Variable | Where | What |
|---|---|---|
| `VERCEL_API_TOKEN` | server | Vercel token (Account → Tokens) used to buy domains and attach them to this project. Create a NEW token — never reuse one that was exposed. |
| `VERCEL_PROJECT_ID` | server | This project's id or name (Project → Settings → General). |
| `VERCEL_TEAM_ID` | server | Only when the project belongs to a team. |
| `DOMAIN_MARKUP_PERCENT` | server | Commission on top of the registrar price (default 30). |
| `DOMAIN_MIN_FEE_USD` | server | Minimum commission (default 5). |
| `DOMAIN_MAX_COST_USD` | server | Highest registrar price bought automatically (default 60; premium domains are refused). |
| `DOMAIN_AUTO_RENEW` | server | `true` = renew bought domains automatically on the platform's Vercel account (default off). |
| `SITES_ROOT_DOMAIN` | server | e.g. `sites.example.com` with a wildcard domain on the project → every site at `{slug}.sites.example.com`. |
| `SITES_DEFAULT_LANG` | server | Language for wildcard subdomains (default `he`). |
| `VERCEL_API_BASE` | tests | Mock base URL. |

The global CSP now allows Google Fonts, https images, YouTube/Vimeo embeds and the PayPal JS SDK (needed after in-app navigation).

## Waves 15–18 — CRM intelligence, conversation guard, agent+, marketing, growth (all optional)
Server-only. Every feature works without its variable; the related screen says what is missing.

| Variable | What |
|---|---|
| `ENCRYPTION_KEY` | Already required for channels. Also encrypts the PayPal / Morning / iCount / Meta / GA4 / TikTok / calendar credentials and signs the one-tap reminder links (`/a/…`). |
| `CRON_SECRET` | Already used. GitHub Actions now also calls `/api/cron/growth` every 5 minutes (planned follow-ups & scheduled messages, task + appointment reminders, duplicate merge, lead scores, calendar busy times, A/B winners, site-event retention). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar two-way sync (OAuth client of type "Web"; redirect URI `https://YOUR-DOMAIN/api/calendar/google/callback`; scope Calendar). |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Outlook / Microsoft 365 calendar (Azure app registration; redirect `https://YOUR-DOMAIN/api/calendar/microsoft/callback`; `Calendars.ReadWrite offline_access`). |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Voice replies of the agent (text-to-speech). Without them `OPENAI_API_KEY` is used (`AI_OPENAI_TTS_MODEL`, `AI_OPENAI_TTS_VOICE`). |
| `AI_GROQ_WHISPER_MODEL`, `AI_OPENAI_TRANSCRIBE_MODEL`, `AI_GEMINI_MEDIA_MODEL` | Voice-message transcription (Groq Whisper → OpenAI → Gemini, first key that exists). |
| (same Gemini / Anthropic keys) | Reading PDF documents customers send on Telegram / WhatsApp (Gemini native PDF → Claude). `.txt` files are read without AI. Card / ID-like numbers are masked. |
| `AI_GROQ_VISION_MODEL`, `AI_OPENAI_VISION_MODEL`, `AI_ANTHROPIC_VISION_MODEL` | Image understanding of customer photos. |
| `VIDEO_MEET_BASE` | Video-call rooms (default `https://meet.jit.si`). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push to members' phones / computers. Generate with `node scripts/setup/generate-vapid.mjs`; `VAPID_SUBJECT` = `mailto:you@your-domain`. |
| `CREDIT_PACKS_JSON` | AI credit packs for sale, e.g. `[{"key":"ai_1000","credits":1000,"usd":15}]` (default 500/$9, 2000/$29, 10000/$99). Paid by PayPal (`PAYPAL_*`) or crypto (`NOWPAYMENTS_*`). |
| `ORG_PAYPAL_API_BASE`, `MORNING_API_BASE`, `ICOUNT_API_BASE`, `META_GRAPH_BASE`, `GA4_MP_BASE`, `TIKTOK_API_BASE`, `GOOGLE_CALENDAR_API_BASE`, `MS_GRAPH_API_BASE`, `GOOGLE_OAUTH_AUTHORIZE_URL`, `GOOGLE_OAUTH_TOKEN_URL`, `MICROSOFT_OAUTH_AUTHORIZE_URL`, `MICROSOFT_OAUTH_TOKEN_URL`, `ELEVENLABS_API_BASE`, `AI_OPENAI_BASE_URL`, `AI_ANTHROPIC_BASE_URL`, `PUSH_TEST_ENDPOINT_BASE` | Base-URL overrides for tests / proxies only — leave unset in production. |

Per-business connections are entered in the app (never in Vercel): the business's own PayPal (Finance → Settings), Morning / iCount (Finance → Settings), Meta Pixel / GA4 / TikTok (Integrations → Ad conversions), Twilio voice webhook (Integrations), calendars (Settings → My calendar).

Migrations: `20261015000032_crm_intelligence.sql`, `20261015000033_conversation_guard.sql`, `20261015000034_ai_agent_plus.sql`, `20261015000035_marketing_growth.sql`, `20261015000036_growth_admin.sql`, `20261015000037_followup_sentiment.sql`.
