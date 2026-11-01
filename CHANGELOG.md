# Changelog

## Enterprise core — 2026-11-01
- **Mission Control** (`/{locale}/health`): status of email, social, payments, delivery queue, websites, surveys and every channel, with reasons and fix links; failed deliveries with retry / cancel / retry-all; background job runs and grouped errors for platform admins.
- **Observability:** structured JSON logger with PII/secret redaction (`lib/ops/log.ts`), server error capture (`instrumentation.ts`), browser error reports (`/api/errors`), grouped `app_errors`, optional Sentry via `SENTRY_DSN`; `/api/health` live checks (database, storage, queue lag).
- **Cron governance:** `job_runs` with a database lock against overlapping runs for every scheduled route.
- **Loading / error screens** for every dashboard module (skeleton per layout, event id, retry, copy, support).
- **Daily post:** the created post opens at once in an editor drawer (publish now, fresh version, duplicate, delete), progress stages, retry without losing the topic, highlighted "new" in the calendar.
- **Saved views** for contacts (personal / shared).
- **Satisfaction surveys** (CSAT / NPS / CES) after a closed conversation, public one-click page `/r/{token}`, low-score alerts.
- **Security:** two-step sign-in (authenticator app) with `/mfa` step, sign out other devices.
- **Privacy:** personal-data export (JSON) and anonymization per contact; audit log CSV export.
- **API:** OpenAPI 3.1 at `/api/public/v1/openapi.json`, reference at `/{locale}/docs/api`.
- Docs: `BUILD_STATUS.md` rewritten to the real state.

## Wave 61 — 2026-11-01
Social brain (daily autopilot posts with image/video, learning from engagement, Motion Studio, phone preview, versions per network, smart hashtags, Telegram channel); WhatsApp Meta diagnosis and "stuck" guide; every platform email falls back to the connected mailbox.

## Wave 60 — 2026-10-31
WhatsApp auto-registration (#133010) + fix button with PIN; transfer number shown as a call target; Pixel ID autofill guard; clear Twilio assign errors.

## Wave 59 — 2026-10-31
Smarter agent (learning, coach, opener A/B), missed-call text-back, outbound calls, recordings, connection health center, quick start, pay in chat, smart review requests, minute packs.

## Earlier
Waves 1–58: foundation, CRM, inbox and channels, AI agents, automations, campaigns, websites, forms, meetings, finance, social studio, phone agent — see the git history.
