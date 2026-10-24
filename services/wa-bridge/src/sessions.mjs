// WhatsApp sessions (one per connected business account), persisted on disk.
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { RecentIds, attachMediaData, formatPairCode, jidFromPhone, pairPhone, splitBubbles, typingPauseMs, messageMime, newMessageId, phoneFromJid, sign, toInboundEvent, toOwnerEvent, validSessionId, wantsMediaData } from "./util.mjs";
import { decodeVoice } from "./util.mjs"; // wave 22

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
  constructor({ dataDir, secret, baileys, fetchImpl = fetch, logger = console, ownerDelayMs = 1500, pauseScale = 1 }) {
    /** wave 21: 0 in tests (no real "typing…" pauses between bubbles) */
    this.pauseScale = pauseScale;
    /** wave 12: owner messages are checked after a short delay so the bridge's own sends are recognised */
    this.ownerDelayMs = ownerDelayMs;
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
    // wave 20: "code" = waiting for the 8-character code to be typed in WhatsApp on the phone
    return { status: s.status, qr: s.status === "qr" ? s.qr : null, phone: s.phone, name: s.name, error: s.error, code: s.status === "code" ? (s.code ?? null) : null };
  }

  async start(id, callback, { waitMs = 8000 } = {}) {
    if (!validSessionId(id)) throw Object.assign(new Error("invalid_id"), { code: 400 });
    await mkdir(this.dir(id), { recursive: true });
    await writeFile(path.join(this.dir(id), "meta.json"), JSON.stringify({ callback }), "utf8");
    const existing = this.sessions.get(id);
    // wave 20: switching back from "link with phone number" to the QR code
    if (existing && !existing.stopped && existing.mode === "code" && existing.status === "code") {
      existing.mode = "qr";
      existing.code = null;
      existing.status = existing.qr ? "qr" : "starting";
    }
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
    session.sentIds = session.sentIds ?? new RecentIds(500);
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
      // wave 20: a replaced socket (new code / reconnect) never drives the current session
      if (this.sessions.get(id)?.sock !== sock) return;
      this.onConnectionUpdate(id, u).catch((e) => this.log.error?.("connection.update failed", e?.message));
    });
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      // wave 12: what the owner types himself on the phone → recorded, the agent steps back
      if (type === "notify" || type === "append") {
        for (const m of messages ?? []) {
          if (!m?.key?.fromMe) continue;
          const ts = Number(m.messageTimestamp ?? 0);
          if (ts && Date.now() / 1000 - ts > 300) continue; // history sync, not a live message
          setTimeout(() => {
            const ev = toOwnerEvent(m, session.sentIds, session.phone);
            // wave 21: when it was written (the app tells an automatic greeting from a person by the timing)
            if (ev) this.post(id, { ...ev, ts: ts || null }).catch(() => {});
          }, this.ownerDelayMs).unref?.();
        }
      }
      if (type !== "notify") return;
      for (const m of messages ?? []) {
        const ev = toInboundEvent(m);
        if (!ev) continue;
        // wave 21: remember the customer's latest message → blue ticks when the agent answers
        session.lastIn = session.lastIn ?? new Map();
        session.lastIn.set(ev.from, m.key);
        if (session.lastIn.size > 2000) session.lastIn.delete(session.lastIn.keys().next().value);
        ev.ts = Number(m.messageTimestamp ?? 0) || null;
        // wave 16: voice notes and images are downloaded (≤ 6 MB) so the agent can understand them
        this.withMedia(m, ev)
          .then((full) => this.post(id, full))
          .catch(() => this.post(id, ev).catch(() => {}));
      }
    });
    return session;
  }

  async onConnectionUpdate(id, u) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (u.qr) {
      // the image first, then the status — so a caller never sees "qr" without the picture
      s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      // wave 20: while a phone-number code is shown, the rotating QR stays in the background
      s.status = s.mode === "code" && s.code ? "code" : "qr";
    }
    if (u.connection === "open") {
      s.status = "connected";
      s.qr = null;
      s.code = null;
      s.mode = null;
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

  /**
   * wave 20 — "Link with phone number": WhatsApp shows an 8-character code field on the phone
   * (Linked devices → Link a device → Link with phone number instead). Works on the same phone
   * that shows the page, where scanning a QR is impossible.
   */
  async pair(id, callback, phoneRaw, { waitMs = 9000 } = {}) {
    if (!validSessionId(id)) throw Object.assign(new Error("invalid_id"), { code: 400 });
    const phone = pairPhone(phoneRaw);
    if (!phone) throw Object.assign(new Error("invalid_phone"), { code: 400 });
    let s = this.sessions.get(id);
    if (s && !s.stopped && s.status === "connected") return this.status(id);
    // a device that is already linked is never wiped (it may just be reconnecting)
    if (s?.sock?.authState?.creds?.account) return this.status(id);
    if (s) {
      s.stopped = true;
      try {
        s.sock?.end?.(undefined);
      } catch {
        /* ignore */
      }
      this.sessions.delete(id);
    }
    // a code only works for a fresh, unlinked device
    await rm(this.dir(id), { recursive: true, force: true }).catch(() => {});
    await mkdir(this.dir(id), { recursive: true });
    await writeFile(path.join(this.dir(id), "meta.json"), JSON.stringify({ callback }), "utf8");
    s = await this.connect(id, callback);
    s.mode = "code";
    s.code = null;
    // the socket is ready for the request once WhatsApp sent the first QR
    const until = Date.now() + waitMs;
    while (Date.now() < until && !s.qr && s.status !== "connected") await wait(150);
    if (s.status === "connected") return this.status(id);
    if (typeof s.sock?.requestPairingCode !== "function") throw Object.assign(new Error("pairing_unsupported"), { code: 501 });
    if (!s.qr) throw Object.assign(new Error("not_ready"), { code: 503 });
    const raw = await s.sock.requestPairingCode(phone);
    s.code = formatPairCode(raw);
    s.codePhone = phone;
    s.status = "code";
    return this.status(id);
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
    // wave 21: the customer's message turns blue (read) the moment the agent answers
    const digits = String(to ?? "").replace(/[^\d]/g, "");
    const lastKey = s.lastIn?.get(digits);
    if (lastKey && typeof s.sock.readMessages === "function") {
      try {
        await s.sock.readMessages([lastKey]);
      } catch {
        /* best effort */
      }
    }
    // wave 21: a long text goes out as up to 3 natural bubbles with "typing…" between them
    const parts = img ? [body] : splitBubbles(body);
    let lastId = null;
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        try {
          await s.sock.sendPresenceUpdate?.("composing", jid);
        } catch {
          /* ignore */
        }
        await wait(typingPauseMs(parts[i]) * this.pauseScale);
      }
      const messageId = newMessageId();
      s.sentIds?.add(messageId);
      const r = await s.sock.sendMessage(jid, img ? { image: { url: img }, caption: body.slice(0, 1000) } : { text: parts[i] }, { messageId });
      s.sentIds?.add(r?.key?.id);
      lastId = r?.key?.id ?? messageId;
    }
    if (parts.length > 1) {
      try {
        await s.sock.sendPresenceUpdate?.("paused", jid);
      } catch {
        /* ignore */
      }
    }
    return lastId;
  }

  /**
   * Wave 22 — the agent answers a voice note with a voice note: OGG/Opus goes out as a real
   * WhatsApp voice message (push-to-talk), MP3 as an audio file.
   */
  async sendVoice(id, to, audioB64, mime) {
    const s = this.sessions.get(id);
    if (!s || s.stopped) throw Object.assign(new Error("not_found"), { code: 404 });
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 409 });
    const jid = jidFromPhone(to);
    if (!jid) throw Object.assign(new Error("invalid_recipient"), { code: 400 });
    const v = decodeVoice(audioB64, mime);
    if (!v) throw Object.assign(new Error("invalid_audio"), { code: 400 });
    try {
      await s.sock.sendPresenceUpdate?.("recording", jid);
    } catch {
      /* ignore */
    }
    const messageId = newMessageId();
    s.sentIds?.add(messageId);
    const r = await s.sock.sendMessage(jid, { audio: v.buf, mimetype: v.mime, ptt: v.ogg }, { messageId });
    s.sentIds?.add(r?.key?.id);
    try {
      await s.sock.sendPresenceUpdate?.("paused", jid);
    } catch {
      /* ignore */
    }
    return r?.key?.id ?? messageId;
  }

  /** speed upgrade: "typing…" (composing) in the customer's WhatsApp while the agent thinks. Never throws. */
  async typing(id, to, on = true) {
    const s = this.sessions.get(id);
    if (!s || s.stopped || s.status !== "connected") return false;
    const jid = jidFromPhone(to);
    if (!jid || typeof s.sock?.sendPresenceUpdate !== "function") return false;
    try {
      await s.sock.sendPresenceUpdate(on ? "composing" : "paused", jid);
      return true;
    } catch {
      return false;
    }
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

  /** wave 16 — base64 media for voice notes / images; the plain event when not possible. */
  async withMedia(m, ev) {
    const download = this.baileys?.downloadMediaMessage;
    if (!ev?.media || !wantsMediaData(ev.media.type, messageMime(m.message), ev.media.name) || typeof download !== "function") return ev;
    try {
      const buffer = await download(m, "buffer", {});
      return attachMediaData(ev, buffer, messageMime(m.message));
    } catch {
      return ev;
    }
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
