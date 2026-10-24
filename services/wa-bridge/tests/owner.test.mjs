import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";
import { toTelegramOwnerEvent } from "../src/telegram-user.mjs";
import { RecentIds, newMessageId, toOwnerEvent } from "../src/util.mjs";

/** Wave 12 — the owner answers himself from his phone → the app records it and the agent steps back. */
const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-555555555555";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"a".repeat(48)}`;
const now = () => Math.floor(Date.now() / 1000);

test("toOwnerEvent: own messages to a customer only", () => {
  const sent = new RecentIds(3);
  sent.add("BOT1");
  const msg = (key, message = { conversation: "אני כאן, מה צריך?" }) => ({ key: { fromMe: true, ...key }, message });
  assert.deepEqual(toOwnerEvent(msg({ id: "O1", remoteJid: "972509998888@s.whatsapp.net" }), sent, "972501112222"), { type: "owner_message", id: "O1", to: "972509998888", text: "אני כאן, מה צריך?", media: null });
  assert.equal(toOwnerEvent(msg({ id: "BOT1", remoteJid: "972509998888@s.whatsapp.net" }), sent), null, "bridge's own send");
  assert.equal(toOwnerEvent({ key: { id: "I1", remoteJid: "972509998888@s.whatsapp.net" }, message: { conversation: "x" } }, sent), null, "incoming");
  assert.equal(toOwnerEvent(msg({ id: "G", remoteJid: "1203@g.us" }), sent), null, "group");
  assert.equal(toOwnerEvent(msg({ id: "S", remoteJid: "972501112222@s.whatsapp.net" }), sent, "972501112222"), null, "message yourself");
  assert.equal(toOwnerEvent(msg({ id: "R", remoteJid: "972509998888@s.whatsapp.net" }, { reactionMessage: { text: "👍" } }), sent), null, "reaction");
  assert.deepEqual(toOwnerEvent(msg({ id: "L", remoteJid: "abc@lid", senderPn: "972509998888@s.whatsapp.net" }), sent).to, "972509998888");
  for (const x of ["a", "b", "c", "d"]) sent.add(x);
  assert.equal(sent.has("BOT1"), false, "bounded");
  assert.match(newMessageId(), /^3EB0[0-9A-F]{16}$/);
});

test("toTelegramOwnerEvent: outgoing private messages, not the bridge's own or Saved Messages", () => {
  const ev = (m, extra = {}) => ({ message: { out: true, id: 7, message: "שלום, כאן בעל העסק", peerId: { userId: 123456 }, ...m }, isPrivate: true, ...extra });
  assert.deepEqual(toTelegramOwnerEvent(ev({})), { type: "owner_message", id: "123456:7", to: "123456", text: "שלום, כאן בעל העסק", media: null });
  assert.equal(toTelegramOwnerEvent(ev({}), new Set(["123456:7"])), null);
  assert.equal(toTelegramOwnerEvent(ev({ out: false })), null);
  assert.equal(toTelegramOwnerEvent(ev({}, { isPrivate: false })), null);
  assert.equal(toTelegramOwnerEvent(ev({}), new Set(), "123456"), null);
});

test("session: owner types on the phone → owner_message posted; the bridge's own reply is not", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wab-"));
  const posts = [];
  const sockets = [];
  const baileys = {
    DisconnectReason: { loggedOut: 401 },
    async useMultiFileAuthState() {
      return { state: { creds: {} }, saveCreds: async () => {} };
    },
    makeWASocket() {
      const ev = new EventEmitter();
      const sock = {
        ev,
        user: null,
        sent: [],
        async sendMessage(jid, content, opts) {
          sock.sent.push({ jid, content, opts });
          const id = opts?.messageId ?? `OUT${sock.sent.length}`;
          // Baileys emits its own send as an "append" upsert before resolving
          ev.emit("messages.upsert", { type: "append", messages: [{ key: { fromMe: true, id, remoteJid: jid }, messageTimestamp: now(), message: content.text ? { conversation: content.text } : {} }] });
          return { key: { id } };
        },
        async logout() {},
      };
      sockets.push(sock);
      return sock;
    },
  };
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {} }, ownerDelayMs: 20 });
  const p = mgr.start(ID, CB, { waitMs: 200 });
  await new Promise((r) => setTimeout(r, 30));
  const sock = sockets[0];
  sock.user = { id: "972501112222:5@s.whatsapp.net", name: "Biz" };
  sock.ev.emit("connection.update", { connection: "open" });
  await p;
  await new Promise((r) => setTimeout(r, 30));

  const outId = await mgr.send(ID, "972509998888", "תשובת הסוכן");
  assert.match(outId, /^3EB0/);
  assert.equal(sock.sent[0].opts.messageId, outId);
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { fromMe: true, id: "PHONE1", remoteJid: "972509998888@s.whatsapp.net" }, messageTimestamp: now(), message: { conversation: "היי, כאן בעל העסק" } }] });
  // an old message from history sync is ignored
  sock.ev.emit("messages.upsert", { type: "append", messages: [{ key: { fromMe: true, id: "OLD", remoteJid: "972509998888@s.whatsapp.net" }, messageTimestamp: now() - 3600, message: { conversation: "ישן" } }] });
  await new Promise((r) => setTimeout(r, 80));
  const owner = posts.filter((x) => x.type === "owner_message");
  // wave 21: the event also carries when it was written (ts, seconds) — the app tells an automatic greeting from a person
  assert.deepEqual(owner.map(({ ts, ...rest }) => (void ts, rest)), [{ type: "owner_message", id: "PHONE1", to: "972509998888", text: "היי, כאן בעל העסק", media: null }]);
  assert.ok(owner.every((x) => x.ts === null || typeof x.ts === "number"));
  await mgr.logout(ID);
  await rm(dataDir, { recursive: true, force: true });
});
