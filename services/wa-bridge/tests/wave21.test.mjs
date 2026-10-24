import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";
import { splitBubbles, typingPauseMs } from "../src/util.mjs";

const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-777777777777";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"c".repeat(48)}`;

test("long answers become up to 3 natural bubbles; short stay one", () => {
  assert.deepEqual(splitBubbles("שלום! מה שלומך?"), ["שלום! מה שלומך?"]);
  const p = (n, ch) => ch.repeat(n);
  const long = [p(200, "א"), p(200, "ב"), p(200, "ג"), p(200, "ד"), "1. תספורת\n2. צבע"].join("\n\n");
  const parts = splitBubbles(long);
  assert.ok(parts.length >= 2 && parts.length <= 3, `got ${parts.length}`);
  assert.equal(parts.join("\n\n"), long, "nothing is lost or reordered");
  assert.ok(parts[parts.length - 1].includes("1. תספורת\n2. צבע"), "the choice list stays together");
  assert.deepEqual(splitBubbles(p(900, "x")), [p(900, "x")], "one long paragraph is not cut");
  assert.ok(typingPauseMs("short") < typingPauseMs(p(100, "x")));
  assert.equal(typingPauseMs(p(5000, "x")), 1800);
});

test("the agent's answer: blue ticks on the customer's message, bubbles sent in order, all known as the bridge's own", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "w21-"));
  const posts = [];
  const sockets = [];
  const baileys = {
    DisconnectReason: { loggedOut: 401 },
    Browsers: { ubuntu: (n) => ["Ubuntu", n, "1"] },
    async useMultiFileAuthState() {
      return { state: { creds: {} }, saveCreds: async () => {} };
    },
    makeWASocket() {
      const ev = new EventEmitter();
      const sock = {
        ev,
        user: { id: "972501112222:5@s.whatsapp.net", name: "Biz" },
        sent: [],
        read: [],
        presence: [],
        async sendMessage(jid, content, opts) {
          sock.sent.push({ jid, content, id: opts?.messageId });
          return { key: { id: opts?.messageId } };
        },
        async readMessages(keys) {
          sock.read.push(...keys);
        },
        async sendPresenceUpdate(state, jid) {
          sock.presence.push([state, jid]);
        },
      };
      sockets.push(sock);
      return sock;
    },
  };
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {} }, ownerDelayMs: 10, pauseScale: 0 });
  const starting = mgr.start(ID, CB, { waitMs: 500 });
  await new Promise((r) => setTimeout(r, 20));
  sockets[0].ev.emit("connection.update", { connection: "open" });
  await starting;
  // a customer writes
  const key = { id: "IN1", remoteJid: "972509998888@s.whatsapp.net", fromMe: false };
  sockets[0].ev.emit("messages.upsert", { type: "notify", messages: [{ key, pushName: "Dana", messageTimestamp: 1_792_000_000, message: { conversation: "היי, מה המחירים?" } }] });
  await new Promise((r) => setTimeout(r, 30));
  const inbound = posts.find((x) => x.type === "message");
  assert.equal(inbound.ts, 1_792_000_000);
  // the agent answers with a long text
  const text = ["מחירון:", "א".repeat(300), "ב".repeat(300), "1. תספורת\n2. צבע"].join("\n\n");
  const lastId = await mgr.send(ID, "972509998888", text);
  const s = sockets[0];
  assert.deepEqual(s.read, [key], "the customer's message is marked read");
  assert.ok(s.sent.length >= 2 && s.sent.length <= 3);
  assert.equal(s.sent.map((x) => x.content.text).join("\n\n"), text);
  assert.equal(lastId, s.sent[s.sent.length - 1].id);
  assert.ok(s.presence.some(([st]) => st === "composing"));
  // WhatsApp echoes every bubble back as fromMe → none of them is mistaken for the owner typing
  for (const m of s.sent) sockets[0].ev.emit("messages.upsert", { type: "append", messages: [{ key: { id: m.id, remoteJid: m.jid, fromMe: true }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: m.content.text } }] });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(posts.filter((x) => x.type === "owner_message").length, 0);
});
