# Changelog

## Digital team, stage-1 audit, model routing, design + performance — 2026-11-02
- **Stage 1 audit:** all 289 server actions and 78 API routes reviewed (identity, permission, validation, translations); fixes: two missing translations, AI studio permission + "deleted" truth; a permanent CI guard (`tests/unit/actions-audit.test.ts`); table in `docs/audit/stage1-actions.md`.
- **Digital team (behind the `team_v1` flag):** 12 roles + custom, a playbook file per role (he + en), the 8-phase work cycle (understand → context → plan → execute → self-check → peer review → deliver → summarize/learn), the manager's dependency-graph planning and assignment by load, handoffs with full context, structured messages, one approval queue, autonomy levels with explicit per-action autonomy, emergency stop, depth / step / credit limits and loop detection, prompt-injection defence, an append-only activity log, three-layer memory with confidence, expiry, contradiction resolution and owner-confirmed learning, daily initiative and the weekly team meeting, metrics per employee. The existing agents and capabilities are the team's tools (CRM, inbox with its guard, social brain, site builder, business agents, reviews, calendar).
- **Model routing by kind of work** on top of the existing router (plan / review / write / site / classify / summarize / vision), database routing table, per-business preference, automatic fallback logged.
- **"My team" screen** (`/ai-team`): 3D presentation (rotating ring, drag / swipe / keyboard, auto-rotate, add card), grid, org chart, animated customizable avatars (idle / working / waiting / success / error), full editor (profile + look, personality, tools, autonomy, memory, history, performance, test chat), hire gallery, goals + plan approval + live board, approvals (bulk, edit, reject with a reason), memory screen, playbooks, weekly meeting + performance, live activity, settings with the emergency stop.
- **Design:** motion / radius / elevation tokens, consistent hover / focus / disabled states in the dashboard, soft route transitions, toasts with close.
- **Performance:** additive indexes (inbound messages per business 37 ms → 0.65 ms on 600k rows), the team screen in its own lazy chunk, optimistic approvals.
- **Tests:** 17 evaluation scenarios + 5 orchestrator checks, unit tests for every core, database tests (isolation, append-only log, constraints), an E2E spec for the team.

## Meta for everyone, smarter site agent and social brain — 2026-11-02
- **Facebook / Instagram without waiting for Meta's review** (Integrations → "2 more ways to connect"):
  - *Join as a tester* — the platform invites the person to the platform app automatically (Meta app-roles API); when Meta refuses, the request waits for a platform admin with one-click "added".
  - *Your own Meta app* — the business pastes App ID + App Secret (checked with Meta, stored encrypted), webhooks are configured automatically, then "Connect through my app" (full-page login, several Pages chooser). Works at once, independent of the platform app.
  - The Page webhook accepts the business's own app (verify token by hash, signature by that app's secret) — and only for that business's Pages. The 1-minute sync checks the business's own app subscription.
  - A failed one-click connection ("App not active") opens the alternatives automatically.
- **Site agent with tools:** real business facts (contact, products & prices, real reviews, knowledge articles, social links) in the prompt and in the site; invented testimonials replaced with real reviews; site settings (footer, legal, WhatsApp button) filled; free photos for hero / about / gallery (Pexels → Pixabay → Openverse); quality audit + one AI fix pass; live build stages and a report (facts · photos · quality score).
- **Social brain — deeper understanding:** learns which openings, weekdays, emoji use, calls to action and hashtag counts work; reads what customers asked in the inbox lately; knows the day/season of the post; real products & prices; self-checks every draft and rewrites a weak one once with concrete feedback. Shown in the brain panel.
- **Design layer:** animated light border for featured sections, hover glow for tiles, gradient page titles, mesh headers, a breathing primary action (all off for reduced motion).

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
