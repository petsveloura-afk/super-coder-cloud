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
import { authorized, validCallback, validSessionId } from "./util.mjs";

export function createServer({ manager, secret, appUrl }) {
  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://bridge");
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, sessions: manager.sessions.size });
      if (!authorized(req.headers.authorization, secret)) return send(401, { error: "unauthorized" });
      const m = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(start|send|logout))?$/);
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
      if (req.method === "POST" && action === "send") {
        const msgId = await manager.send(id, body.to, body.text);
        return send(200, { ok: true, id: msgId });
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
    logger: pino({ level: process.env.LOG_LEVEL ?? "warn" }),
  };
  const manager = new SessionManager({ dataDir: process.env.DATA_DIR ?? "/data", secret, baileys });
  const restored = await manager.restoreAll();
  const port = Number(process.env.PORT ?? 8080);
  createServer({ manager, secret, appUrl }).listen(port, () => console.log(`wa-bridge listening on :${port} (restored ${restored} sessions)`));

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
