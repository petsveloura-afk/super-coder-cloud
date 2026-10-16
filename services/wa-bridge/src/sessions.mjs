// WhatsApp sessions (one per connected business account), persisted on disk.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { jidFromPhone, phoneFromJid, sign, toInboundEvent, validSessionId } from "./util.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class SessionManager {
  /**
   * @param {object} o
   * @param {string} o.dataDir     persistent directory (Railway volume, e.g. /data)
   * @param {string} o.secret      shared secret (WA_BRIDGE_SECRET) used to sign callbacks
   * @param {object} o.baileys     { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion }
   * @param {Function} [o.fetchImpl]
   * @param {object} [o.logger]
   */
  constructor({ dataDir, secret, baileys, fetchImpl = fetch, logger = console }) {
    this.dataDir = dataDir;
    this.secret = secret;
    this.baileys = baileys;
    this.fetch = fetchImpl;
    this.log = logger;
    /** @type {Map<string, {sock:any,status:string,qr:string|null,phone:string|null,name:string|null,callback:string,stopped:boolean,retries:number,error:string|null}>} */
    this.sessions = new Map();
  }

  dir(id) {
    return path.join(this.dataDir, "sessions", id);
  }

  status(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { status: s.status, qr: s.status === "qr" ? s.qr : null, phone: s.phone, name: s.name, error: s.error };
  }

  async start(id, callback, { waitMs = 8000 } = {}) {
    if (!validSessionId(id)) throw Object.assign(new Error("invalid_id"), { code: 400 });
    await mkdir(this.dir(id), { recursive: true });
    await writeFile(path.join(this.dir(id), "meta.json"), JSON.stringify({ callback }), "utf8");
    const existing = this.sessions.get(id);
    if (existing && !existing.stopped && ["connected", "qr", "starting"].includes(existing.status)) {
      existing.callback = callback;
      return this.status(id);
    }
    await this.connect(id, callback);
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const st = this.sessions.get(id)?.status;
      if (st === "qr" || st === "connected" || st === "logged_out") break;
      await wait(150);
    }
    return this.status(id);
  }

  async connect(id, callback) {
    const { makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = this.baileys;
    const prev = this.sessions.get(id);
    const session = prev ?? { sock: null, status: "starting", qr: null, phone: null, name: null, callback, stopped: false, retries: 0, error: null };
    session.status = "starting";
    session.callback = callback;
    session.stopped = false;
    this.sessions.set(id, session);

    const { state, saveCreds } = await useMultiFileAuthState(this.dir(id));
    let version;
    try {
      version = fetchLatestBaileysVersion ? (await fetchLatestBaileysVersion()).version : undefined;
    } catch {
      version = undefined;
    }
    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: Browsers ? Browsers.ubuntu("Super Coder Cloud") : undefined,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: this.baileys.logger,
    });
    session.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      this.onConnectionUpdate(id, u).catch((e) => this.log.error?.("connection.update failed", e?.message));
    });
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages ?? []) {
        const ev = toInboundEvent(m);
        if (ev) this.post(id, ev).catch(() => {});
      }
    });
    return session;
  }

  async onConnectionUpdate(id, u) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (u.qr) {
      s.status = "qr";
      s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
    }
    if (u.connection === "open") {
      s.status = "connected";
      s.qr = null;
      s.retries = 0;
      s.error = null;
      s.phone = phoneFromJid(s.sock?.user?.id ?? "") ?? (s.sock?.user?.id ?? "").split(":")[0].split("@")[0] ?? null;
      s.name = s.sock?.user?.name ?? null;
      await this.post(id, { type: "status", status: "connected", phone: s.phone, name: s.name });
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === (this.baileys.DisconnectReason?.loggedOut ?? 401);
      if (loggedOut) {
        s.status = "logged_out";
        s.stopped = true;
        await rm(this.dir(id), { recursive: true, force: true }).catch(() => {});
        await this.post(id, { type: "status", status: "logged_out" });
        return;
      }
      if (s.stopped) return;
      s.status = "starting";
      s.retries += 1;
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(s.retries, 6));
      setTimeout(() => {
        if (!s.stopped) this.connect(id, s.callback).catch((e) => (s.error = e?.message ?? "reconnect_failed"));
      }, delay).unref?.();
    }
  }

  async send(id, to, text, image = null) {
    const s = this.sessions.get(id);
    if (!s || s.stopped) throw Object.assign(new Error("not_found"), { code: 404 });
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 409 });
    const jid = jidFromPhone(to);
    if (!jid) throw Object.assign(new Error("invalid_recipient"), { code: 400 });
    const body = String(text ?? "").slice(0, 4000);
    const img = typeof image === "string" && /^https:\/\/\S+$/.test(image) ? image : null;
    if (!body.trim() && !img) throw Object.assign(new Error("empty"), { code: 400 });
    const r = await s.sock.sendMessage(jid, img ? { image: { url: img }, caption: body.slice(0, 1000) } : { text: body });
    return r?.key?.id ?? null;
  }

  async logout(id) {
    const s = this.sessions.get(id);
    if (s) {
      s.stopped = true;
      try {
        await s.sock?.logout();
      } catch {
        try {
          s.sock?.end?.(undefined);
        } catch {
          /* ignore */
        }
      }
      this.sessions.delete(id);
    }
    await rm(this.dir(id), { recursive: true, force: true }).catch(() => {});
  }

  async post(id, payload) {
    const s = this.sessions.get(id);
    if (!s?.callback) return;
    const body = JSON.stringify(payload);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetch(s.callback, { method: "POST", headers: { "Content-Type": "application/json", ...sign(this.secret, body) }, body, signal: AbortSignal.timeout(15_000) });
        if (res.ok || (res.status >= 400 && res.status < 500)) return;
      } catch {
        /* retry */
      }
      await wait(1000 * (attempt + 1));
    }
  }

  /** Re-opens every saved session after a restart / deploy. */
  async restoreAll() {
    const root = path.join(this.dataDir, "sessions");
    await mkdir(root, { recursive: true });
    const ids = (await readdir(root)).filter(validSessionId);
    for (const id of ids) {
      try {
        await stat(path.join(root, id, "creds.json"));
        const meta = JSON.parse(await readFile(path.join(root, id, "meta.json"), "utf8"));
        await this.connect(id, meta.callback);
      } catch {
        // incomplete session (QR never scanned) — skip
      }
    }
    return ids.length;
  }
}
