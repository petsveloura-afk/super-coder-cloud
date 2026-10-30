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
  constructor({ dataDir, secret, api, lib, fetchImpl = fetch, logger = console, ownerDelayMs = 1500 }) {
    this.ownerDelayMs = ownerDelayMs;
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
    return { status: s.status, qr: s.status === "qr" ? s.qr : null, phone: s.phone, name: s.name, username: s.username, hint: s.status === "password" ? s.hint : null, error: s.error };
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
    const client = new TelegramClient(new StringSession(saved), this.api.apiId, this.api.apiHash, { connectionRetries: 5 });
    s.client = client;
    await client.connect();
    const authorized = saved ? await client.checkAuthorization().catch(() => false) : false;
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
    s.qr = null;
    s.error = null;
    s.phone = me?.phone ? String(me.phone) : null;
    s.name = [me?.firstName, me?.lastName].filter(Boolean).join(" ") || null;
    s.username = me?.username ?? null;
    s.client.addEventHandler(async (event) => {
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
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 409 });
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
    if (s.status !== "connected") throw Object.assign(new Error("not_connected"), { code: 409 });
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
      } catch {
        /* skip broken session */
      }
    }
    return n;
  }
}
