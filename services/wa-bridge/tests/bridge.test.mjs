import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";
import { createServer } from "../src/server.mjs";
import { authorized, jidFromPhone, messageText, phoneFromJid, toInboundEvent, validCallback } from "../src/util.mjs";

const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"a".repeat(48)}`;

test("jid helpers and message parsing", () => {
  assert.equal(phoneFromJid("972501234567@s.whatsapp.net"), "972501234567");
  assert.equal(phoneFromJid("972501234567:12@s.whatsapp.net"), "972501234567");
  assert.equal(phoneFromJid("12036302@g.us"), null);
  assert.equal(jidFromPhone("+972-50-1234567"), "972501234567@s.whatsapp.net");
  assert.equal(messageText({ extendedTextMessage: { text: "שלום" } }), "שלום");
  assert.equal(messageText({ ephemeralMessage: { message: { conversation: "hi" } } }), "hi");
  assert.equal(toInboundEvent({ key: { fromMe: true, remoteJid: "1@s.whatsapp.net" }, message: { conversation: "x" } }), null);
  assert.equal(toInboundEvent({ key: { remoteJid: "123@g.us" }, message: { conversation: "x" } }), null);
  assert.equal(toInboundEvent({ key: { remoteJid: "status@broadcast" }, message: { conversation: "x" } }), null);
  const ev = toInboundEvent({ key: { id: "M1", remoteJid: "abc@lid", senderPn: "972501234567@s.whatsapp.net" }, pushName: "Dana", message: { conversation: "מה המחיר?" } });
  assert.deepEqual(ev, { type: "message", id: "M1", from: "972501234567", name: "Dana", text: "מה המחיר?", isGroup: false, media: null });
});

test("auth and callback validation", () => {
  assert.equal(authorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(authorized("Bearer nope", SECRET), false);
  assert.equal(authorized(`Bearer ${SECRET}`, "short"), false);
  assert.equal(validCallback(CB, "https://app.example.com"), true);
  assert.equal(validCallback(CB, "https://other.example.com"), false);
  assert.equal(validCallback("https://evil.example.com/x", ""), false);
});

function fakeBaileys() {
  const sockets = [];
  return {
    sockets,
    DisconnectReason: { loggedOut: 401 },
    Browsers: { ubuntu: (n) => [n, "Chrome", "1"] },
    async useMultiFileAuthState() {
      return { state: { creds: {} }, saveCreds: async () => {} };
    },
    makeWASocket() {
      const ev = new EventEmitter();
      const sock = {
        ev,
        user: null,
        sent: [],
        async sendMessage(jid, content) {
          sock.sent.push({ jid, content });
          return { key: { id: `OUT${sock.sent.length}` } };
        },
        async logout() {
          sock.loggedOut = true;
        },
      };
      sockets.push(sock);
      return sock;
    },
  };
}

test("session lifecycle: QR → connected → inbound message → reply → logout (signed callbacks)", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wab-"));
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response("{}", { status: 200 });
  };
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl, logger: { error() {} } });
  const starting = mgr.start(ID, CB, { waitMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));
  baileys.sockets[0].ev.emit("connection.update", { qr: "2@abc,def" });
  const st = await starting;
  assert.equal(st.status, "qr");
  assert.match(st.qr, /^data:image\/png;base64,/);

  const sock = baileys.sockets[0];
  sock.user = { id: "972501112222:5@s.whatsapp.net", name: "פט-ליין" };
  sock.ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(mgr.status(ID).status, "connected");
  assert.equal(mgr.status(ID).phone, "972501112222");
  const statusPost = posts.find((p) => p.body.type === "status");
  assert.deepEqual(statusPost.body, { type: "status", status: "connected", phone: "972501112222", name: "פט-ליין" });
  // signature = HMAC(secret, ts + "." + body)
  const ts = statusPost.headers["X-SCC-Timestamp"];
  const expected = createHmac("sha256", SECRET).update(`${ts}.${JSON.stringify(statusPost.body)}`).digest("hex");
  assert.equal(statusPost.headers["X-SCC-Signature"], expected);

  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "IN1", remoteJid: "972509998888@s.whatsapp.net" }, pushName: "Dana", message: { conversation: "היי" } }] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posts.at(-1).body.text, "היי");
  assert.equal(posts.at(-1).url, CB);

  const id = await mgr.send(ID, "972509998888", "שלום דנה!");
  assert.equal(id, "OUT1");
  assert.deepEqual(sock.sent[0], { jid: "972509998888@s.whatsapp.net", content: { text: "שלום דנה!" } });

  await mgr.logout(ID);
  assert.equal(sock.loggedOut, true);
  assert.equal(mgr.status(ID), null);
  await assert.rejects(stat(path.join(dataDir, "sessions", ID)));
  await rm(dataDir, { recursive: true, force: true });
});

test("logged out by the phone → session removed and the app is told", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wab-"));
  const posts = [];
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {} } });
  const p = mgr.start(ID, CB, { waitMs: 300 });
  await new Promise((r) => setTimeout(r, 30));
  baileys.sockets[0].ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await p;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(mgr.status(ID).status, "logged_out");
  assert.deepEqual(posts.at(-1), { type: "status", status: "logged_out" });
  await assert.rejects(mgr.send(ID, "972500000000", "x"));
  await rm(dataDir, { recursive: true, force: true });
});

test("HTTP API requires the shared secret and validates input", async () => {
  const calls = [];
  const manager = {
    sessions: new Map(),
    status: (id) => (id === ID ? { status: "connected" } : null),
    start: async (id, cb) => (calls.push(["start", id, cb]), { status: "qr", qr: "data:x" }),
    send: async (id, to, text) => (calls.push(["send", id, to, text]), "OUT9"),
    logout: async (id) => calls.push(["logout", id]),
  };
  const server = createServer({ manager, secret: SECRET, appUrl: "https://app.example.com" });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/sessions/${ID}`)).status, 401);
    assert.equal((await fetch(`${base}/sessions/not-a-uuid`, { headers: auth })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/sessions/${ID}`, { headers: auth })).json(), { status: "connected" });
    assert.equal((await fetch(`${base}/sessions/${ID}/start`, { method: "POST", headers: auth, body: JSON.stringify({ callback: "https://evil.example.com/api/channels/whatsapp_qr/" + "a".repeat(48) }) })).status, 400);
    const ok = await fetch(`${base}/sessions/${ID}/start`, { method: "POST", headers: auth, body: JSON.stringify({ callback: CB }) });
    assert.equal(ok.status, 200);
    const sent = await (await fetch(`${base}/sessions/${ID}/send`, { method: "POST", headers: auth, body: JSON.stringify({ to: "972501234567", text: "hi" }) })).json();
    assert.deepEqual(sent, { ok: true, id: "OUT9" });
    assert.deepEqual(calls.map((c) => c[0]), ["start", "send"]);
  } finally {
    server.close();
  }
});
