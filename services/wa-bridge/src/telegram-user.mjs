// Personal Telegram accounts (MTProto "user" sessions) — the business connects its
// own Telegram account by scanning a QR code (Telegram → Settings → Devices →
// Link Desktop Device). Incoming private messages are forwarded to the web app
// (signed) and the AI agent / team answers from the account itself.
//
// Needs TELEGRAM_API_ID + TELEGRAM_API_HASH (my.telegram.org → API development tools).
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { sign, validSessionId } from "./util.mjs";
import { decodeVoice } from "./util.mjs"; // wave 22

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Converts a GramJS NewMessage event to the bridge callback payload (null = ignore). */
export async function toTelegramUserEvent(event) {
  const m = event?.message;
  if (!m || m.out) return null;
  if (event.isPrivate === false) return null; // groups / channels are never answered
  let sender = null;
  try {
    sender = await m.getSender();
  } catch {
    sender = null;
  }
  if (!sender || sender.bot) return null;
  const from = String(sender.id ?? "");
  if (!/^\d{3,20}$/.test(from)) return null;
  const text = String(m.message ?? "").slice(0, 8000);
  let media = m.media ? { type: m.photo ? "photo" : m.voice ? "voice" : m.audio ? "audio" : m.document ? "document" : "media" } : null;
  const docMime = m.document?.mimeType ?? "";
  const docName = (m.document?.attributes ?? []).find((a) => a?.fileName)?.fileName;
  if (media && media.type === "document" && docName) media = { ...media, name: String(docName).slice(0, 200) };
  const readableDoc = media?.type === "document" && (/^application\/pdf|^text\/plain/.test(docMime) || /\.(pdf|txt)$/i.test(docName ?? ""));
  // wave 16: voice notes and photos are downloaded (≤ 6 MB) so the agent can understand them
  if (media && (media.type === "voice" || media.type === "photo" || media.type === "audio" || readableDoc) && typeof m.downloadMedia === "function") {
    try {
      const buf = await m.downloadMedia();
      if (buf && buf.length && buf.length <= 6 * 1024 * 1024) {
        media = { ...media, data: Buffer.from(buf).toString("base64"), mime: media.type === "photo" ? "image/jpeg" : readableDoc ? docMime || "application/pdf" : m.document?.mimeType ?? "audio/ogg" };
      }
    } catch {
      // keep the message without the media data
    }
  }
  if (!text && !media) return null;
  return {
    type: "message",
    id: `${from}:${m.id}`,
    from,
    name: [sender.firstName, sender.lastName].filter(Boolean).join(" ") || sender.username || null,
    phone: sender.phone ? String(sender.phone) : null,
    username: sender.username ?? null,
    accessHash: sender.accessHash != null ? String(sender.accessHash) : null,
    text,
    media,
  };
}

/**
 * Wave 12 — a message the account owner sent himself (from his phone / Telegram app)
 * in a private chat → `owner_message`, so the agent steps back in that chat.
 * Messages the bridge itself sent (`sentIds`) and "Saved Messages" are ignored.
 */
export function toTelegramOwnerEvent(event, sentIds = new Set(), meId = null) {
  const m = event?.message;
  if (!m || !m.out) return null;
  if (event.isPrivate === false) return null;
  const uid = String(m.peerId?.userId ?? m.chatId ?? "");
  if (!/^\d{3,20}$/.test(uid)) return null;
  if (meId && uid === String(meId)) return null;
  const id = `${uid}:${m.id}`;
  if (sentIds.has(id)) return null;
  const text = String(m.message ?? "").slice(0, 8000);
  const media = m.media ? { type: m.photo ? "photo" : m.document ? "document" : "media" } : null;
  if (!text && !media) return null;
  return { type: "owner_message", id, to: uid, text, media };
}

/**
 * Wave 57 — texts the bridge is sending right now (before Telegram returns the message id). A slow send
 * must never look like the owner typing: the echo is matched by chat + text for two minutes.
 */
export function rememberOutgoing(list, uid, text, now = Date.now()) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const keep = list.filter((p) => now - p.at < 120_000);
  if (t) keep.push({ uid: String(uid), text: t, at: now });
  return keep.slice(-200);
}

export function isOwnOutgoing(list, ev, now = Date.now()) {
  if (!ev || !Array.isArray(list)) return false;
  const t = String(ev.text ?? "").replace(/\s+/g, " ").trim();
  // the agent's voice note (no text): matched by chat while a voice send is in flight
  if (!t) return Boolean(ev.media) && list.some((p) => p.uid === String(ev.to) && p.text === "\u0000voice" && now - p.at < 120_000);
  return list.some((p) => p.uid === String(ev.to) && now - p.at < 120_000 && (p.text === t || (t.length >= 8 && p.text.includes(t))));
}

export class TelegramUserManager {
  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {string} o.secret
   * @param {{apiId:number, apiHash:string}|null} o.api
   * @param {object} o.lib  { TelegramClient, StringSession, NewMessage, Api, bigInt }
   */
  constructor({ dataDir, secret, api, lib, fetchImpl = fetch, logger = console, ownerDelayMs = 1500, authRetryMs = 2500, postRetryMs = 1000 }) {
    this.ownerDelayMs = ownerDelayMs;
    this.authRetryMs = authRetryMs; // wave 62: pause between authorization re-checks at start-up
    this.postRetryMs = postRetryMs; // wave 62: base back-off for delivering a message to the web app
    this.watchdogTimer = null;
    this.dataDir = dataDir;
    this.secret = secret;
    this.api = api;
    this.lib = lib;
    this.fetch = fetchImpl;
    this.log = logger;
    this.sessions = new Map();
  }

  configured() {
    return Boolean(this.api?.apiId && this.api?.apiHash && this.lib);
  }

  dir(id) {
    return path.join(this.dataDir, "telegram", id);
  }

  status(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { status: s.status, qr: s.status === "qr" ? s.qr : null, phone: s.phone, name: s.name, username: s.username, hint: s.status === "password" ? s.hint : null, error: s.error, last_event_at: s.lastEventAt ?? null, reconnects: s.reconnects ?? 0 };
  }

  async readFileSafe(p) {
    try {
      return await readFile(p, "utf8");
    } catch {
      return null;
    }
  }

  async start(id, callback, { waitMs = 8000 } = {}) {
    if (!validSessionId(id)) throw Object.assign(new Error("invalid_id"), { code: 400 });
    if (!this.configured()) throw Object.assign(new Error("tg_not_configured"), { code: 503 });
    await mkdir(this.dir(id), { recursive: true });
    await writeFile(path.join(this.dir(id), "meta.json"), JSON.stringify({ callback }), "utf8");
    const existing = this.sessions.get(id);
    if (existing && !existing.stopped && ["connected", "qr", "password", "starting"].includes(existing.status)) {
      existing.callback = callback;
      return this.status(id);
    }
    await this.connect(id, callback);
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const st = this.sessions.get(id)?.status;
      if (st && st !== "starting") break;
      await wait(150);
    }
    return this.status(id);
  }

  async connect(id, callback) {
    const { TelegramClient, StringSession } = this.lib;
    const saved = (await this.readFileSafe(path.join(this.dir(id), "session.txt"))) ?? "";
    const s = this.sessions.get(id) ?? { status: "starting", qr: null, phone: null, name: null, username: null, hint: null, error: null, callback, stopped: false, client: null, pw: null, peers: {} };
    s.status = "starting";
    s.callback = callback;
    s.stopped = false;
    try {
      s.peers = JSON.parse((await this.readFileSafe(path.join(this.dir(id), "peers.json"))) ?? "{}");
    } catch {
      s.peers = {};
    }
    this.sessions.set(id, s);
    // wave 62: a previous client of this account is closed first — never two live clients (duplicate answers / dead handlers)
    if (s.client) {
      const old = s.client;
      s.client = null;
      await old.disconnect?.().catch?.(() => {});
      await old.destroy?.().catch?.(() => {});
    }
    const client = new TelegramClient(new StringSession(saved), this.api.apiId, this.api.apiHash, { connectionRetries: 10, retryDelay: 2000, autoReconnect: true });
    s.client = client;
    try {
      await client.connect();
    } catch (e) {
      // a saved session must survive a network hiccup: keep it and let the watchdog reconnect
      if (!saved) throw e;
      s.status = "reconnecting";
      s.error = e?.message ?? "connect_failed";
      this.log.error?.(`telegram user ${id}: connect failed, will retry`, s.error);
      return s;
    }
    let authorized = saved ? await client.checkAuthorization().catch(() => false) : false;
    if (saved && !authorized) {
      // wave 62: "not authorized" can be a short network problem — re-check a few times, then ask Telegram itself
      for (let i = 0; i < 3 && !authorized; i++) {
        await wait(this.authRetryMs);
        authorized = await client.checkAuthorization().catch(() => false);
      }
      if (!authorized) {
        const kind = await this.probeAuth(client);
        if (kind === "ok") authorized = true;
        else if (kind === "network") {
          s.status = "reconnecting";
          s.error = "network";
          return s; // the session file is kept; the watchdog tries again — never a QR for a healthy account
        } else {
          s.error = "logged_out";
          this.post(id, { type: "status", status: "logged_out" }).catch(() => {});
        }
      }
    }
    if (authorized) {
      await this.onLoggedIn(id);
      return s;
    }
    // QR login (2FA password asked through the app when the account has one)
    client
      .signInUserWithQrCode(
        { apiId: this.api.apiId, apiHash: this.api.apiHash },
        {
          qrCode: async ({ token }) => {
            // wave 25: once the account asked for its 2FA password, a refreshed QR token must not overwrite that state
            if (s.status === "password") return;
            s.status = "qr";
            s.qr = await QRCode.toDataURL(`tg://login?token=${Buffer.from(token).toString("base64url")}`, { margin: 1, width: 320 });
          },
          password: async (hint) => {
            s.status = "password";
            s.hint = hint ?? null;
            return await new Promise((resolve) => (s.pw = resolve));
          },
          onError: async (err) => {
            s.error = err?.message ?? "login_error";
            if (/PASSWORD_HASH_INVALID/.test(s.error)) s.status = "password";
            return false; // keep trying (new QR tokens)
          },
        },
      )
      .then(() => this.onLoggedIn(id))
      .catch((e) => {
        s.status = "error";
        s.error = e?.message ?? "login_failed";
      });
    return s;
  }

  async onLoggedIn(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    const { NewMessage } = this.lib;
    await writeFile(path.join(this.dir(id), "session.txt"), s.client.session.save(), "utf8");
    const me = await s.client.getMe().catch(() => null);
    s.status = "connected";
    s.connectedAt = Date.now();
    s.lastPing = Date.now();
    s.qr = null;
    s.error = null;
    s.phone = me?.phone ? String(me.phone) : null;
    s.name = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || null;
    s.username = me?.username ?? null;
    s.client.addEventHandler(async (event) => {
      s.lastEventAt = Date.now();
      const ev = await toTelegramUserEvent(event);
      if (!ev) return;
      if (ev.accessHash) {
        s.peers[ev.from] = ev.accessHash;
        writeFile(path.join(this.dir(id), "peers.json"), JSON.stringify(s.peers), "utf8").catch(() => {});
      }
      const { accessHash, ...payload } = ev;
      void accessHash;
      this.post(id, payload).catch(() => {});
    }, new NewMessage({ incoming: true }));
    // wave 12: what the owner writes himself → recorded, the agent steps back in that chat
    s.sentIds = s.sentIds ?? new Set();
    s.meId = me?.id != null ? String(me.id) : null;
    s.client.addEventHandler((event) => {
      setTimeout(() => {
        const ev = toTelegramOwnerEvent(event, s.sentIds, s.meId);
        // wave 57: the agent's own reply whose send was still in flight is not "the owner typing"
        if (ev && isOwnOutgoing(s.pendingOut, ev)) return;
        if (ev) this.post(id, ev).catch(() => {});
      }, this.ownerDelayMs ?? 1500).unref?.();
    }, new NewMessage({ outgoing: true }));
    await this.post(id, { type: "status", status: "connected", phone: s.phone, name: s.name, username: s.username });
  }

  password(id, value) {
    const s = this.sessions.get(id);
    if (!s || s.status !== "password" || !s.pw) throw Object.assign(new Error("no_password_needed"), { code: 409 });
    const resolve = s.pw;
    s.pw = null;
    s.status = "starting";
    resolve(String(value ?? ""));
    return { status: "starting" };
  }

  async send(id, to, text) {
    const s = this.sessions.get(id);
    if (!s || s.stopped) throw Object.assign(new Error("not_found"), { code: 404 });
    if (s.status !== "connected") await this.heal(id); // wave 62: one quick reconnect before giving up
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 503 });
    const uid = String(to ?? "").replace(/[^\d]/g, "");
    if (!/^\d{3,20}$/.test(uid)) throw Object.assign(new Error("invalid_recipient"), { code: 400 });
    const body = String(text ?? "").slice(0, 4000);
    if (!body.trim()) throw Object.assign(new Error("empty"), { code: 400 });
    const { Api, bigInt } = this.lib;
    const hash = s.peers[uid];
    const peer = hash && Api && bigInt ? new Api.InputPeerUser({ userId: bigInt(uid), accessHash: bigInt(hash) }) : uid;
    s.pendingOut = rememberOutgoing(s.pendingOut ?? [], uid, body); // wave 57: known before Telegram answers
    const r = await s.client.sendMessage(peer, { message: body });
    if (r?.id != null) {
      s.sentIds = s.sentIds ?? new Set();
      s.sentIds.add(`${uid}:${r.id}`);
      if (s.sentIds.size > 500) s.sentIds.delete(s.sentIds.values().next().value);
    }
    return r?.id != null ? `${uid}:${r.id}` : null;
  }

  /** Wave 22 — the agent's spoken answer as a Telegram voice note (OGG/Opus) or audio (MP3). */
  async sendVoice(id, to, audioB64, mime) {
    const s = this.sessions.get(id);
    if (!s || s.stopped) throw Object.assign(new Error("not_found"), { code: 404 });
    if (s.status !== "connected") await this.heal(id);
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 503 });
    const uid = String(to ?? "").replace(/[^\d]/g, "");
    if (!/^\d{3,20}$/.test(uid)) throw Object.assign(new Error("invalid_recipient"), { code: 400 });
    const v = decodeVoice(audioB64, mime);
    if (!v) throw Object.assign(new Error("invalid_audio"), { code: 400 });
    const { Api, bigInt, CustomFile } = this.lib;
    if (!CustomFile) throw Object.assign(new Error("voice_unsupported"), { code: 501 });
    const hash = s.peers[uid];
    const peer = hash && Api && bigInt ? new Api.InputPeerUser({ userId: bigInt(uid), accessHash: bigInt(hash) }) : uid;
    const file = new CustomFile(v.ogg ? "voice.ogg" : "voice.mp3", v.buf.length, "", v.buf);
    s.pendingOut = rememberOutgoing(s.pendingOut ?? [], uid, "\u0000voice"); // wave 57
    const r = await s.client.sendFile(peer, { file, voiceNote: v.ogg, forceDocument: false });
    if (r?.id != null) {
      s.sentIds = s.sentIds ?? new Set();
      s.sentIds.add(`${uid}:${r.id}`);
      if (s.sentIds.size > 500) s.sentIds.delete(s.sentIds.values().next().value);
    }
    return r?.id != null ? `${uid}:${r.id}` : null;
  }

  async logout(id) {
    const s = this.sessions.get(id);
    if (s) {
      s.stopped = true;
      try {
        await s.client?.invoke?.(new this.lib.Api.auth.LogOut());
      } catch {
        /* ignore */
      }
      try {
        await s.client?.disconnect?.();
      } catch {
        /* ignore */
      }
      this.sessions.delete(id);
    }
    await rm(this.dir(id), { recursive: true, force: true }).catch(() => {});
  }

  async post(id, payload) {
    const s = this.sessions.get(id);
    if (!s?.callback) return;
    const body = JSON.stringify(payload);
    // wave 62: a message from a customer must reach the web app — network errors, 5xx and 429 are retried with a growing pause
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await this.fetch(s.callback, { method: "POST", headers: { "Content-Type": "application/json", ...sign(this.secret, body) }, body, signal: AbortSignal.timeout(20_000) });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
          this.log.error?.(`telegram user ${id}: web app refused the callback (HTTP ${res.status})`);
          return;
        }
      } catch {
        /* retry */
      }
      await wait(this.postRetryMs * 2 ** attempt);
    }
    this.log.error?.(`telegram user ${id}: could not deliver a ${payload?.type ?? "event"} to the web app`);
  }

  /** Telegram itself tells whether the saved session is valid: "ok" | "revoked" (really logged out) | "network" */
  async probeAuth(client) {
    try {
      await client.getMe();
      return "ok";
    } catch (e) {
      const m = String(e?.errorMessage ?? e?.message ?? "");
      if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED/i.test(m)) return "revoked";
      return "network";
    }
  }

  /** a cheap round-trip to Telegram (updates.getState) — proves the connection is really alive */
  async ping(s) {
    try {
      const Req = this.lib.Api?.updates?.GetState;
      const call = Req ? s.client.invoke(new Req()) : s.client.getMe();
      await Promise.race([call, new Promise((_, rej) => setTimeout(() => rej(new Error("ping_timeout")), 20_000).unref?.())]);
      s.lastPing = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /** closes the old client, opens a new one for the same saved session and catches up on what was missed */
  async reconnect(id, why = "watchdog") {
    const s = this.sessions.get(id);
    if (!s || s.stopped || s.reconnecting) return;
    s.reconnecting = true;
    try {
      this.log.warn?.(`telegram user ${id}: reconnecting (${why})`);
      s.reconnects = (s.reconnects ?? 0) + 1;
      await this.connect(id, s.callback);
      if (s.status === "connected") {
        s.error = null;
        s.failedChecks = 0;
        await s.client?.catchUp?.().catch?.(() => {});
      }
    } catch (e) {
      s.status = "reconnecting";
      s.error = e?.message ?? "reconnect_failed";
    } finally {
      s.reconnecting = false;
    }
  }

  /** used before a send: reconnect once, wait at most ~12 seconds */
  async heal(id) {
    const s = this.sessions.get(id);
    if (!s || s.stopped) return;
    if (s.reconnecting) {
      const until = Date.now() + 12_000;
      while (s.reconnecting && Date.now() < until) await wait(250);
      return;
    }
    await Promise.race([this.reconnect(id, "send"), wait(12_000)]);
  }

  /** every account is checked regularly: a dropped or silently dead connection is rebuilt without anybody touching it */
  async checkAll({ pingEveryMs = 180_000 } = {}) {
    for (const [id, s] of this.sessions) {
      if (s.stopped || s.reconnecting) continue;
      if (s.status === "reconnecting") {
        await this.reconnect(id, "retry");
        continue;
      }
      if (s.status !== "connected") continue;
      let dead = !s.client || s.client.connected === false;
      if (!dead && Date.now() - (s.lastPing ?? 0) >= pingEveryMs) dead = !(await this.ping(s));
      if (dead) {
        s.failedChecks = (s.failedChecks ?? 0) + 1;
        await this.reconnect(id, "connection lost");
      }
    }
  }

  startWatchdog({ intervalMs = 45_000, pingEveryMs = 180_000 } = {}) {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      this.checkAll({ pingEveryMs }).catch((e) => this.log.error?.("telegram watchdog failed", e?.message));
    }, intervalMs);
    this.watchdogTimer.unref?.();
  }

  stopWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  summary() {
    let connected = 0;
    for (const s of this.sessions.values()) if (s.status === "connected") connected++;
    return { sessions: this.sessions.size, connected };
  }

  async restoreAll() {
    if (!this.configured()) return 0;
    const root = path.join(this.dataDir, "telegram");
    await mkdir(root, { recursive: true });
    const ids = (await readdir(root)).filter(validSessionId);
    let n = 0;
    for (const id of ids) {
      const session = await this.readFileSafe(path.join(root, id, "session.txt"));
      const meta = await this.readFileSafe(path.join(root, id, "meta.json"));
      if (!session || !meta) continue;
      try {
        await this.connect(id, JSON.parse(meta).callback);
        n++;
      } catch (e) {
        // wave 62: never dropped — the session stays in the list as "reconnecting" and the watchdog keeps trying
        const cur = this.sessions.get(id);
        if (cur) {
          cur.status = "reconnecting";
          cur.error = e?.message ?? "restore_failed";
        }
      }
    }
    return n;
  }
}
