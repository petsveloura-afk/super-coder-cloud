import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TelegramUserManager, toTelegramUserEvent } from "../src/telegram-user.mjs";
import { validCallback } from "../src/util.mjs";

const SECRET = "t".repeat(32);
const ID = "21111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/telegram_user/${"b".repeat(48)}`;

function fakeLib() {
  const clients = [];
  class TelegramClient {
    constructor(session) {
      this.session = { save: () => "SESSION-STRING", value: session.value };
      this.handlers = [];
      this.sent = [];
      clients.push(this);
    }
    async connect() {}
    async checkAuthorization() {
      return this.session.value === "SESSION-STRING";
    }
    signInUserWithQrCode(_api, params) {
      this.params = params;
      return new Promise((resolve) => (this.finishLogin = resolve));
    }
    async getMe() {
      return { phone: "972501234567", firstName: "Pet", lastName: "Line", username: "petline" };
    }
    addEventHandler(fn) {
      this.handlers.push(fn);
    }
    async sendMessage(peer, { message }) {
      this.sent.push({ peer, message });
      return { id: 77 };
    }
    async disconnect() {}
  }
  class StringSession {
    constructor(v) {
      this.value = v;
    }
  }
  class NewMessage {}
  class InputPeerUser {
    constructor(o) {
      Object.assign(this, o);
    }
  }
  return { clients, lib: { TelegramClient, StringSession, NewMessage, Api: { InputPeerUser, auth: { LogOut: class {} } }, bigInt: (v) => `big:${v}` } };
}

test("callback validation accepts the telegram_user route", () => {
  assert.equal(validCallback(CB, "https://app.example.com"), true);
});

test("events: private incoming messages only, with the sender's details", async () => {
  const ev = (o) => ({ isPrivate: true, message: { id: 5, out: false, message: "היי", getSender: async () => ({ id: 123456, firstName: "דנה", phone: "972500000000", accessHash: 99 }), ...o } });
  assert.deepEqual(await toTelegramUserEvent(ev({})), { type: "message", id: "123456:5", from: "123456", name: "דנה", phone: "972500000000", username: null, accessHash: "99", text: "היי", media: null });
  assert.equal(await toTelegramUserEvent(ev({ out: true })), null);
  assert.equal(await toTelegramUserEvent({ ...ev({}), isPrivate: false }), null);
  assert.equal(await toTelegramUserEvent(ev({ getSender: async () => ({ id: 1, bot: true }) })), null);
});

test("QR login → 2FA password → connected → inbound forwarded → reply with access hash → session restored", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "tgu-"));
  const posts = [];
  const { clients, lib } = fakeLib();
  const mgr = new TelegramUserManager({ dataDir, secret: SECRET, api: { apiId: 1, apiHash: "a".repeat(32) }, lib, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {} } });
  const starting = mgr.start(ID, CB, { waitMs: 1500 });
  await new Promise((r) => setTimeout(r, 30));
  const c = clients[0];
  await c.params.qrCode({ token: Buffer.from("tok"), expires: 0 });
  const st = await starting;
  assert.equal(st.status, "qr");
  assert.match(st.qr, /^data:image\/png;base64,/);

  // the account has a 2FA password
  const pw = c.params.password("my hint");
  assert.equal(mgr.status(ID).status, "password");
  assert.equal(mgr.status(ID).hint, "my hint");
  mgr.password(ID, "secret-pass");
  assert.equal(await pw, "secret-pass");
  c.finishLogin({});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(mgr.status(ID).status, "connected");
  assert.equal(await readFile(path.join(dataDir, "telegram", ID, "session.txt"), "utf8"), "SESSION-STRING");
  assert.deepEqual(posts.at(-1), { type: "status", status: "connected", phone: "972501234567", name: "Pet Line", username: "petline" });

  await c.handlers[0]({ isPrivate: true, message: { id: 9, out: false, message: "כמה עולה?", getSender: async () => ({ id: 555777, firstName: "רון", accessHash: 42 }) } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts.at(-1).text, "כמה עולה?");
  assert.equal(posts.at(-1).accessHash, undefined); // never leaves the bridge

  assert.equal(await mgr.send(ID, "555777", "150 ₪"), "555777:77");
  assert.deepEqual({ ...c.sent[0].peer }, { userId: "big:555777", accessHash: "big:42" });

  // restart: the saved session reconnects without a QR
  const again = new TelegramUserManager({ dataDir, secret: SECRET, api: { apiId: 1, apiHash: "a".repeat(32) }, lib, fetchImpl: async () => new Response("{}"), logger: { error() {} } });
  assert.equal(await again.restoreAll(), 1);
  assert.equal(again.status(ID).status, "connected");

  await mgr.logout(ID);
  assert.equal(mgr.status(ID), null);
  await rm(dataDir, { recursive: true, force: true });
});

test("not configured without API credentials", async () => {
  const mgr = new TelegramUserManager({ dataDir: os.tmpdir(), secret: SECRET, api: null, lib: null });
  assert.equal(mgr.configured(), false);
  await assert.rejects(mgr.start(ID, CB), /tg_not_configured/);
});

// wave 57 — a slow send is still recognised as the agent's own message (never "the owner typing")
import { isOwnOutgoing, rememberOutgoing } from "../src/telegram-user.mjs";
test("wave 57: own outgoing texts are recognised before Telegram returns the id", () => {
  const now = 1_000_000;
  let list = rememberOutgoing([], "123456", "שלום! מה שלומך?", now);
  assert.equal(isOwnOutgoing(list, { to: "123456", text: "שלום!  מה שלומך?" }, now + 2000), true);
  assert.equal(isOwnOutgoing(list, { to: "999999", text: "שלום! מה שלומך?" }, now + 2000), false);
  assert.equal(isOwnOutgoing(list, { to: "123456", text: "משהו אחר לגמרי" }, now + 2000), false);
  assert.equal(isOwnOutgoing(list, { to: "123456", text: "שלום! מה שלומך?" }, now + 200_000), false);
  list = rememberOutgoing(list, "123456", "", now + 1);
  assert.equal(list.length, 1);
});
test("wave 57: the agent's voice note in flight is not the owner", () => {
  const list = rememberOutgoing([], "123456", "\u0000voice", 5);
  assert.equal(isOwnOutgoing(list, { to: "123456", text: "", media: { type: "media" } }, 10), true);
  assert.equal(isOwnOutgoing(list, { to: "123456", text: "", media: null }, 10), false);
});
