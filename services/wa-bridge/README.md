# WhatsApp QR bridge

An always-on service that lets each business connect **its own WhatsApp by scanning a QR code**, the same way as WhatsApp Web. Customers' messages reach the inbox, and the AI agent answers them.

> ⚠️ **Unofficial.** This is not Meta's official API. WhatsApp may block numbers that use it, especially for bulk messages. For important business numbers, recommend the official connection (the "Connect WhatsApp" button through Meta).

## Deploying on Railway (one time)
1. Railway → **New Project** → **Deploy from GitHub repo** → pick `super-coder-cloud`.
2. In the service's settings: **Root Directory** = `services/wa-bridge`.
3. **Variables:**
   - `WA_BRIDGE_SECRET` = a long random password (at least 24 characters)
   - `APP_URL` = `https://super-coder-cloud.vercel.app`
   - `CRON_SECRET` = the same value as on Vercel (optional: e-mails and automations every minute)
4. **Volumes** → Add Volume → Mount path `/data`.
5. **Networking** → Generate Domain. Copy the address, e.g. `https://wa-bridge-production.up.railway.app`.
6. In Vercel → Environment Variables, add:
   - `WA_BRIDGE_URL` = the address from step 5
   - `WA_BRIDGE_SECRET` = the same password from step 3
   - then Redeploy.

## API (bridge ↔ web app)
Every request needs `Authorization: Bearer WA_BRIDGE_SECRET`.
- `POST /sessions/{accountId}/start` `{callback}` → `{status, qr}` (QR as a data URL)
- `GET /sessions/{accountId}` → `{status: starting|qr|connected|logged_out, qr, phone, name}`
- `POST /sessions/{accountId}/pair` `{callback, phone}` → `{status: "code", code: "ABCD-1234"}` — wave 20: "link with phone number" (for the phone that shows the page; it can't scan its own screen). Typed in WhatsApp → Linked devices → Link a device → Link with phone number instead.
- `POST /sessions/{accountId}/send` `{to, text}` → `{ok, id}`
- `POST /sessions/{accountId}/logout`
- `GET /health`

Callbacks to the web app are signed: `X-SCC-Timestamp` + `X-SCC-Signature = HMAC-SHA256(secret, ts + "." + body)`.

Tests: `npm test`
