import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";

const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"a".repeat(48)}`;

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
        user: { id: "972501112222:5@s.whatsapp.net", name: "Biz" },
        sent: [],
        presence: [],
        async sendMessage(jid, content) {
          sock.sent.push({ jid, content });
          return { key: { id: `OUT${sock.sent.length}` } };
        },
        async sendPresenceUpdate(kind, jid) {
          sock.presence.push([kind, jid]);
        },
      };
      sockets.push(sock);
      return sock;
    },
  };
}

async function connected(posts) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wab-lid-"));
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, pauseScale: 0, ownerDelayMs: 5, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {}, warn() {}, debug() {} } });
  const p = mgr.start(ID, CB, { waitMs: 300 });
  await new Promise((r) => setTimeout(r, 30));
  baileys.sockets[0].ev.emit("connection.update", { connection: "open" });
  await p;
  await new Promise((r) => setTimeout(r, 30));
  return { dataDir, mgr, sock: baileys.sockets[0] };
}

test("a LID-only customer reaches the app and the reply goes back to his LID", async () => {
  const posts = [];
  const { dataDir, mgr, sock } = await connected(posts);
  const LID = "111222333444555";
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "IN1", remoteJid: `${LID}@lid` }, pushName: "Dana", message: { conversation: "מה המחיר?" } }] });
  await new Promise((r) => setTimeout(r, 50));
  const inbound = posts.find((p) => p.type === "message");
  assert.equal(inbound.from, LID);
  assert.equal(inbound.lid, true);
  await mgr.send(ID, LID, "שלום דנה");
  assert.equal(sock.sent.at(-1).jid, `${LID}@lid`);
  assert.equal(await mgr.typing(ID, LID, true), true);
  assert.deepEqual(sock.presence.at(-1), ["composing", `${LID}@lid`]);
  // remembered on disk for the next restart
  await new Promise((r) => setTimeout(r, 2100));
  const saved = JSON.parse(await readFile(path.join(dataDir, "sessions", ID, "jids.json"), "utf8"));
  assert.equal(saved.jids[LID], `${LID}@lid`);
  await rm(dataDir, { recursive: true, force: true });
});

test("a normal phone-number customer is still answered at his phone number", async () => {
  const posts = [];
  const { dataDir, mgr, sock } = await connected(posts);
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "IN2", remoteJid: "972509998888@s.whatsapp.net" }, message: { conversation: "היי" } }] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posts.find((p) => p.type === "message").lid, undefined);
  await mgr.send(ID, "972509998888", "שלום");
  assert.equal(sock.sent.at(-1).jid, "972509998888@s.whatsapp.net");
  await rm(dataDir, { recursive: true, force: true });
});

test("the phone number behind a LID is learned from a later message key", async () => {
  const posts = [];
  const { dataDir, sock } = await connected(posts);
  const LID = "999888777666555";
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "A", remoteJid: `${LID}@lid`, senderPn: "972507776666@s.whatsapp.net" }, message: { conversation: "אחד" } }] });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "B", remoteJid: `${LID}@lid` }, message: { conversation: "שתיים" } }] });
  await new Promise((r) => setTimeout(r, 50));
  const msgs = posts.filter((p) => p.type === "message");
  assert.deepEqual(msgs.map((m) => m.from), ["972507776666", "972507776666"]);
  await rm(dataDir, { recursive: true, force: true });
});
