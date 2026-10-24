import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";
import { TelegramUserManager } from "../src/telegram-user.mjs";
import { createServer } from "../src/server.mjs";
import { decodeVoice } from "../src/util.mjs";

/** Wave 22 — the agent answers a voice note with a voice note (WhatsApp QR + personal Telegram). */
const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"a".repeat(48)}`;
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 1)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 2)]);

test("decodeVoice: OGG/Opus → voice message, MP3 → audio file, junk and huge files refused", () => {
  const o = decodeVoice(OGG.toString("base64"), "audio/ogg");
  assert.equal(o.ogg, true);
  assert.equal(o.mime, "audio/ogg; codecs=opus");
  assert.equal(decodeVoice(OGG.toString("base64"), "").ogg, true); // sniffed from the bytes
  const m = decodeVoice(MP3.toString("base64"), "audio/mpeg");
  assert.equal(m.ogg, false);
  assert.equal(m.mime, "audio/mpeg");
  assert.equal(decodeVoice("", "audio/ogg"), null);
  assert.equal(decodeVoice("not base64 !!", "audio/ogg"), null);
  assert.equal(decodeVoice(Buffer.alloc(3 * 1024 * 1024 + 10).toString("base64"), "audio/ogg"), null);
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
        presence: [],
        async sendMessage(jid, content) {
          sock.sent.push({ jid, content });
          return { key: { id: `OUT${sock.sent.length}` } };
        },
        async sendPresenceUpdate(p, jid) {
          sock.presence.push([p, jid]);
        },
        async logout() {},
      };
      sockets.push(sock);
      return sock;
    },
  };
}

test("WhatsApp (QR): an OGG answer goes out as a push-to-talk voice message, MP3 as audio; over HTTP too", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wab22-"));
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async () => new Response("{}"), logger: { error() {} } });
  const starting = mgr.start(ID, CB, { waitMs: 2000 });
  await new Promise((r) => setTimeout(r, 50));
  const sock = baileys.sockets[0];
  sock.ev.emit("connection.update", { qr: "2@abc" });
  await starting;
  sock.user = { id: "972501112222:5@s.whatsapp.net", name: "x" };
  sock.ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 50));

  const id = await mgr.sendVoice(ID, "972509998888", OGG.toString("base64"), "audio/ogg");
  assert.ok(id);
  const v = sock.sent.at(-1);
  assert.equal(v.jid, "972509998888@s.whatsapp.net");
  assert.equal(v.content.ptt, true);
  assert.equal(v.content.mimetype, "audio/ogg; codecs=opus");
  assert.ok(Buffer.isBuffer(v.content.audio));
  assert.deepEqual(sock.presence[0], ["recording", "972509998888@s.whatsapp.net"]);

  await mgr.sendVoice(ID, "972509998888", MP3.toString("base64"), "audio/mpeg");
  assert.equal(sock.sent.at(-1).content.ptt, false);
  await assert.rejects(mgr.sendVoice(ID, "972509998888", "", "audio/ogg"), /invalid_audio/);
  await assert.rejects(mgr.sendVoice(ID, "x", OGG.toString("base64"), "audio/ogg"), /invalid_recipient/);

  // HTTP: POST /sessions/{id}/voice (larger body allowed than for text)
  const server = createServer({ manager: mgr, secret: SECRET, appUrl: "https://app.example.com" }).listen(0);
  const port = server.address().port;
  const big = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200 * 1024, 3)]).toString("base64");
  const r = await fetch(`http://127.0.0.1:${port}/sessions/${ID}/voice`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ to: "972509998888", audio: big, mime: "audio/ogg" }) });
  assert.equal(r.status, 200);
  assert.equal(sock.sent.at(-1).content.ptt, true);
  const unauth = await fetch(`http://127.0.0.1:${port}/sessions/${ID}/voice`, { method: "POST", body: "{}" });
  assert.equal(unauth.status, 401);
  // text sends keep the small body limit
  const tooBig = await fetch(`http://127.0.0.1:${port}/sessions/${ID}/send`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ to: "972509998888", text: big }) });
  assert.equal(tooBig.status, 413);
  server.close();
  await mgr.logout(ID);
  await rm(dataDir, { recursive: true, force: true });
});

test("personal Telegram: the answer goes out as a voice note through sendFile", async () => {
  class CustomFile {
    constructor(name, size, p, buffer) {
      Object.assign(this, { name, size, path: p, buffer });
    }
  }
  const sent = [];
  const mgr = new TelegramUserManager({ dataDir: os.tmpdir(), secret: SECRET, api: { apiId: 1, apiHash: "a".repeat(32) }, lib: { CustomFile, Api: null, bigInt: null } });
  mgr.sessions.set(ID, {
    status: "connected",
    peers: {},
    client: {
      async sendFile(peer, opts) {
        sent.push({ peer, opts });
        return { id: 77 };
      },
    },
  });
  const id = await mgr.sendVoice(ID, "123456", OGG.toString("base64"), "audio/ogg");
  assert.equal(id, "123456:77");
  assert.equal(sent[0].peer, "123456");
  assert.equal(sent[0].opts.voiceNote, true);
  assert.equal(sent[0].opts.file.name, "voice.ogg");
  assert.equal(sent[0].opts.file.size, OGG.length);
  // our own voice note never comes back as "the owner wrote"
  assert.ok(mgr.sessions.get(ID).sentIds.has("123456:77"));
  await mgr.sendVoice(ID, "123456", MP3.toString("base64"), "audio/mpeg");
  assert.equal(sent[1].opts.voiceNote, false);
  assert.equal(sent[1].opts.file.name, "voice.mp3");
});
