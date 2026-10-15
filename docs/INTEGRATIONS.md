# Integrations

**No external integration is implemented in Phase 1.** None is shown as "active" anywhere in the UI.

Foundations already in place:
- `integrations` table (status: `not_configured | pending | active | error | disabled`, last success/error).
- `integration_credentials` — AES-256-GCM ciphertext, readable only with the service role.
- `integrationAvailability(env)` — platform-level keys detected and reported by `/api/health`.
- `organizations.is_demo` — every future outbound adapter must refuse to send when true.

| Integration | Phase | Official API | Credentials |
|---|---|---|---|
| OpenAI / Anthropic | 4 | Responses API / Messages API | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Telegram bots | 5 | Bot API (webhooks + secret token) | per-org bot token (encrypted) |
| WhatsApp Business | 5 | WhatsApp Cloud API (Meta) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| Facebook / Instagram | 5 | Graph API (approved permissions only) | `META_APP_ID`, `META_APP_SECRET` |
| Email | 5 | Resend/Postmark/SES adapter | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` |
| SMS | 5 | provider adapter | `SMS_PROVIDER_API_KEY` |
| Google Calendar / Gmail | 5 | OAuth 2.0 | per-user OAuth tokens (encrypted) |
| Payments | 6 | Stripe (adapter); Israeli invoicing provider adapter | `PAYMENT_PROVIDER_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` |
| Queue | 3 | e.g. Upstash QStash | `QUEUE_PROVIDER_URL`, `QUEUE_PROVIDER_TOKEN` |

Rule (from the spec, enforced in design): an integration becomes `active` only after a successful live
connection + authorization check; integrations with code but no credentials are "Ready for configuration"
only once contract tests exist.
