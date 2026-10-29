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

## Live phone calls (wave 56)
The same service also runs **live AI phone calls** (like Vapi / Retell): Twilio streams the call audio to
`wss://<this service>/voice/stream`, the bridge detects when the caller speaks, stops talking when the
caller interrupts (short "uh-huh"s do not stop it), and plays the agent's own voice back in real time.
The web app does the thinking (speech-to-text + the full sales brain) and the voice (ElevenLabs / OpenAI),
so **no new variables are needed here** — only `WA_BRIDGE_SECRET` and `APP_URL`, which are already set.

- The web app switches calls to live mode automatically once this version is deployed (`GET /health` →
  `"voice_realtime": true`). Set `VOICE_REALTIME=off` on Vercel to keep turn-by-turn calls.
- Stream authentication: the TwiML carries `call`, `ts` and `sig = HMAC-SHA256(WA_BRIDGE_SECRET, call + "." + ts)`
  (valid for 15 minutes). Callbacks to the web app are signed like every other bridge callback.
- Endpoints called on the web app: `POST /api/voice/realtime/turn`, `/tts` (µ-law 8 kHz stream), `/end`.
