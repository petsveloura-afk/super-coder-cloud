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
  const media = m.media ? { type: m.photo ? "photo" : m.document ? "document" : "media" } : null;
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

export class TelegramUserManager {
  /**
   * @param {object} o
   * @param {string} o.dataDir
   * @param {string} o.secret
   * @param {{apiId:number, apiHash:string}|null} o.api
   * @param {object} o.lib  { TelegramClient, StringSession, NewMessage, Api, bigInt }
   */
  constructor({ dataDir, secret, api, lib, fetchImpl = fetch, logger = console }) {
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
    const r = await s.client.sendMessage(peer, { message: body });
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
