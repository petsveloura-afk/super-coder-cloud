// SUPER CODER CLOUD — WhatsApp QR bridge.
// Always-on service (Railway / any VM). Keeps WhatsApp sessions open, forwards
// incoming messages to the web app (signed) and sends replies.
//
// Env:
//   WA_BRIDGE_SECRET  shared secret (same value in Vercel), ≥ 24 chars — required
//   APP_URL           https://super-coder-cloud.vercel.app — callbacks must point here
//   DATA_DIR          persistent directory for sessions (Railway volume) — default /data
//   PORT              default 8080
//   CRON_SECRET       optional: when set, the bridge also asks the web app every minute
//                     to read new e-mails and run queued automations (faster than GitHub cron)
import http from "node:http";
import { SessionManager } from "./sessions.mjs";
import { authorized, sign, validCallback, validSessionId } from "./util.mjs";

export function createServer({ manager, secret, appUrl, telegram = null }) {
  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://bridge");
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, sessions: manager.sessions.size, telegram: Boolean(telegram?.configured()) });
      if (!authorized(req.headers.authorization, secret)) return send(401, { error: "unauthorized" });
      // personal Telegram accounts: /tg/sessions/{id}[/start|send|logout|password]
      const tg = url.pathname.match(/^\/tg\/sessions\/([^/]+)(?:\/(start|send|logout|password))?$/);
      if (tg) {
        if (!telegram || !telegram.configured()) return send(503, { error: "tg_not_configured" });
        if (!validSessionId(tg[1])) return send(404, { error: "not_found" });
        const [, tid, tact] = tg;
        let tbody = {};
        if (req.method === "POST") {
          const chunks = [];
          let size = 0;
          for await (const c of req) {
            size += c.length;
            if (size > 64 * 1024) return send(413, { error: "too_large" });
            chunks.push(c);
          }
          tbody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        }
        if (req.method === "GET" && !tact) {
          const st = telegram.status(tid);
          return st ? send(200, st) : send(404, { error: "not_found" });
        }
        if (req.method === "POST" && tact === "start") {
          if (!validCallback(tbody.callback, appUrl)) return send(400, { error: "invalid_callback" });
          return send(200, await telegram.start(tid, tbody.callback));
        }
        if (req.method === "POST" && tact === "password") return send(200, telegram.password(tid, tbody.password));
        if (req.method === "POST" && tact === "send") return send(200, { ok: true, id: await telegram.send(tid, tbody.to, tbody.text) });
        if (req.method === "POST" && tact === "logout") {
          await telegram.logout(tid);
          return send(200, { ok: true });
        }
        return send(405, { error: "method_not_allowed" });
      }
      const m = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(start|send|logout|typing|pair))?$/);
      if (!m || !validSessionId(m[1])) return send(404, { error: "not_found" });
      const [, id, action] = m;
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 64 * 1024) return send(413, { error: "too_large" });
          chunks.push(c);
        }
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      }
      if (req.method === "GET" && !action) {
        const st = manager.status(id);
        return st ? send(200, st) : send(404, { error: "not_found" });
      }
      if (req.method === "POST" && action === "start") {
        if (!validCallback(body.callback, appUrl)) return send(400, { error: "invalid_callback" });
        return send(200, await manager.start(id, body.callback));
      }
      // wave 20: link with phone number → { status: "code", code: "ABCD-1234" }
      if (req.method === "POST" && action === "pair") {
        if (!validCallback(body.callback, appUrl)) return send(400, { error: "invalid_callback" });
        return send(200, await manager.pair(id, body.callback, body.phone));
      }
      if (req.method === "POST" && action === "send") {
        const msgId = await manager.send(id, body.to, body.text, body.image ?? null);
        return send(200, { ok: true, id: msgId });
      }
      if (req.method === "POST" && action === "typing") {
        return send(200, { ok: await manager.typing(id, body.to, body.on !== false) });
      }
      if (req.method === "POST" && action === "logout") {
        await manager.logout(id);
        return send(200, { ok: true });
      }
      return send(405, { error: "method_not_allowed" });
    } catch (e) {
      const code = typeof e?.code === "number" ? e.code : 500;
      return send(code, { error: e?.message ?? "error" });
    }
  });
}

async function main() {
  const secret = process.env.WA_BRIDGE_SECRET ?? "";
  if (secret.length < 24) {
    console.error("WA_BRIDGE_SECRET must be set (at least 24 characters)");
    process.exit(1);
  }
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const baileysMod = await import("@whiskeysockets/baileys");
  const pino = (await import("pino")).default;
  const baileys = {
    makeWASocket: baileysMod.makeWASocket ?? baileysMod.default,
    useMultiFileAuthState: baileysMod.useMultiFileAuthState,
    DisconnectReason: baileysMod.DisconnectReason,
    Browsers: baileysMod.Browsers,
    fetchLatestBaileysVersion: baileysMod.fetchLatestBaileysVersion,
    // wave 16: voice notes / images for the agent
    downloadMediaMessage: baileysMod.downloadMediaMessage,
    logger: pino({ level: process.env.LOG_LEVEL ?? "warn" }),
  };
  const manager = new SessionManager({ dataDir: process.env.DATA_DIR ?? "/data", secret, baileys });
  const restored = await manager.restoreAll();

  // personal Telegram accounts (optional): TELEGRAM_API_ID + TELEGRAM_API_HASH
  let telegram = null;
  const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (apiId > 0 && /^[a-f0-9]{32}$/i.test(apiHash)) {
    const gram = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");
    const { NewMessage } = await import("telegram/events/index.js");
    const bigInt = (await import("big-integer")).default;
    const { TelegramUserManager } = await import("./telegram-user.mjs");
    telegram = new TelegramUserManager({
      dataDir: process.env.DATA_DIR ?? "/data",
      secret,
      api: { apiId, apiHash },
      lib: { TelegramClient: gram.TelegramClient, Api: gram.Api, StringSession, NewMessage, bigInt },
    });
    const n = await telegram.restoreAll();
    console.log(`telegram user sessions restored: ${n}`);
  }

  const port = Number(process.env.PORT ?? 8080);
  createServer({ manager, secret, appUrl, telegram }).listen(port, () => console.log(`wa-bridge listening on :${port} (restored ${restored} sessions)`));

  // wave 21: a reliable heartbeat to the web app every 30s, signed with WA_BRIDGE_SECRET (no extra setup):
  // customers who got "on it…" while the AI was busy get their real answer within ~30 seconds,
  // and queued automations go out — GitHub's scheduled runs can be hours late.
  if (appUrl) {
    const beat = async () => {
      const body = JSON.stringify({ sessions: manager.sessions.size, at: Date.now() });
      try {
        await fetch(`${appUrl}/api/bridge/tick`, { method: "POST", headers: { "Content-Type": "application/json", ...sign(secret, body) }, body, signal: AbortSignal.timeout(55_000) });
      } catch {
        /* next beat */
      }
    };
    setTimeout(beat, 20_000).unref();
    setInterval(beat, 30_000).unref();
  }

  // optional heartbeat: faster e-mail reading + automation jobs
  const cron = process.env.CRON_SECRET ?? "";
  if (appUrl && cron) {
    const tick = async () => {
      for (const p of ["/api/channels/email/poll", "/api/jobs/dispatch", "/api/ai/followups"]) {
        try {
          await fetch(`${appUrl}${p}`, { method: "POST", headers: { Authorization: `Bearer ${cron}` }, signal: AbortSignal.timeout(55_000) });
        } catch {
          /* next tick */
        }
      }
    };
    setInterval(tick, 60_000).unref();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
