import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TelegramUserManager } from "../src/telegram-user.mjs";

const SECRET = "t".repeat(32);
const ID = "21111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/telegram_user/${"b".repeat(48)}`;

/** a fake GramJS: `net` decides whether Telegram can be reached, `auth` whether the session is valid */
function fakeLib(net = { up: true, auth: true }) {
  const clients = [];
  class TelegramClient {
    constructor(session) {
      this.session = { save: () => "SESSION-STRING", value: session.value };
      this.connected = true;
      this.handlers = [];
      this.pings = 0;
      clients.push(this);
    }
    async connect() {
      if (!net.up) throw new Error("ECONNRESET");
      this.connected = true;
    }
    async checkAuthorization() {
      return net.up && net.auth;
    }
    async getMe() {
      if (!net.up) throw new Error("ECONNRESET");
      if (!net.auth) throw Object.assign(new Error("401: AUTH_KEY_UNREGISTERED"), { errorMessage: "AUTH_KEY_UNREGISTERED" });
      return { phone: "972501234567", firstName: "A", username: "a" };
    }
    signInUserWithQrCode() {
      return new Promise(() => {});
    }
    addEventHandler(fn) {
      this.handlers.push(fn);
    }
    async invoke() {
      if (!net.up || !this.connected) throw new Error("not connected");
      this.pings++;
    }
    async sendMessage(_peer, { message }) {
      return { id: 5, message };
    }
    async disconnect() {
      this.connected = false;
    }
  }
  class StringSession {
    constructor(v) {
      this.value = v;
    }
  }
  class NewMessage {}
  return { clients, net, lib: { TelegramClient, StringSession, NewMessage, Api: { updates: { GetState: class {} }, auth: { LogOut: class {} } }, bigInt: (v) => v } };
}

async function savedAccount(dir) {
  await mkdir(path.join(dir, "telegram", ID), { recursive: true });
  await writeFile(path.join(dir, "telegram", ID, "session.txt"), "SESSION-STRING");
  await writeFile(path.join(dir, "telegram", ID, "meta.json"), JSON.stringify({ callback: CB }));
}

const mk = async (f, extra = {}) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "tgw62-"));
  await savedAccount(dataDir);
  const posts = [];
  const m = new TelegramUserManager({ dataDir, secret: SECRET, api: { apiId: 1, apiHash: "a".repeat(32) }, lib: f.lib, fetchImpl: async (u, o) => (posts.push(JSON.parse(o.body)), { ok: true, status: 200 }), logger: { error() {}, warn() {}, log() {} }, authRetryMs: 1, postRetryMs: 1, ...extra });
  return { m, posts };
};

test("a network problem at start-up keeps the saved session (no QR, no logout)", async () => {
  const f = fakeLib({ up: false, auth: true });
  const { m } = await mk(f);
  assert.equal(await m.restoreAll(), 1);
  assert.equal(m.status(ID).status, "reconnecting");
  f.net.up = true; // the network is back
  await m.checkAll();
  assert.equal(m.status(ID).status, "connected");
  assert.equal(m.status(ID).qr, null);
});

test("a really revoked session is reported as logged out", async () => {
  const f = fakeLib({ up: true, auth: false });
  const { m, posts } = await mk(f);
  await m.restoreAll();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(posts.some((p) => p.type === "status" && p.status === "logged_out"));
});

test("the watchdog rebuilds a dropped connection with a fresh client", async () => {
  const f = fakeLib();
  const { m } = await mk(f);
  await m.restoreAll();
  assert.equal(m.status(ID).status, "connected");
  const first = f.clients[0];
  first.connected = false; // the socket died
  await m.checkAll();
  assert.equal(f.clients.length, 2);
  assert.equal(m.sessions.get(ID).client, f.clients[1]);
  assert.equal(m.status(ID).status, "connected");
  assert.equal(m.status(ID).reconnects, 1);
});

test("the watchdog notices a silently dead connection with a ping", async () => {
  const f = fakeLib();
  const { m } = await mk(f);
  await m.restoreAll();
  f.net.up = true;
  const s = m.sessions.get(ID);
  s.client.invoke = async () => {
    throw new Error("ping failed");
  };
  await m.checkAll({ pingEveryMs: 0 });
  assert.equal(f.clients.length, 2);
});

test("a send while the connection is down heals first, then goes out", async () => {
  const f = fakeLib();
  const { m } = await mk(f);
  await m.restoreAll();
  m.sessions.get(ID).status = "reconnecting";
  const id = await m.send(ID, "123456", "hello");
  assert.equal(id, "123456:5");
});

test("a message is delivered to the web app after temporary failures", async () => {
  const f = fakeLib();
  let n = 0;
  const { m } = await mk(f, { fetchImpl: async () => (++n < 4 ? { ok: false, status: 502 } : { ok: true, status: 200 }) });
  await m.restoreAll();
  n = 0;
  await m.post(ID, { type: "message", from: "123456", text: "hi" });
  assert.equal(n, 4);
});

test("a refused callback (4xx) is not retried", async () => {
  const f = fakeLib();
  let n = 0;
  const { m } = await mk(f, { fetchImpl: async () => (++n, { ok: false, status: 404 }) });
  await m.restoreAll();
  n = 0;
  await m.post(ID, { type: "message", from: "123456", text: "hi" });
  assert.equal(n, 1);
});
