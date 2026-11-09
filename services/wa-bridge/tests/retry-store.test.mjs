import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";

const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-888888888888";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"d".repeat(48)}`;

// WhatsApp asks for a re-send when a phone could not decrypt a bubble. The bridge must be able to hand the
// original message back (getMessage), otherwise the customer sees "Waiting for this message".
test("sent bubbles can be handed back for a WhatsApp re-send request", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "retry-"));
  let options = null;
  const sockets = [];
  const baileys = {
    DisconnectReason: { loggedOut: 401 },
    Browsers: { ubuntu: (n) => ["Ubuntu", n, "1"] },
    async useMultiFileAuthState() {
      return { state: { creds: {} }, saveCreds: async () => {} };
    },
    makeWASocket(o) {
      options = o;
      const ev = new EventEmitter();
      const sock = {
        ev,
        user: { id: "972501112222:5@s.whatsapp.net", name: "Biz" },
        sent: [],
        async sendMessage(jid, content, opts) {
          sock.sent.push({ jid, content, id: opts?.messageId });
          return { key: { id: opts?.messageId }, message: { conversation: content.text ?? "" } };
        },
        async readMessages() {},
        async sendPresenceUpdate() {},
      };
      sockets.push(sock);
      return sock;
    },
  };
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async () => new Response("{}"), logger: { error() {} }, ownerDelayMs: 10, pauseScale: 0 });
  const starting = mgr.start(ID, CB, { waitMs: 500 });
  await new Promise((r) => setTimeout(r, 20));
  sockets[0].ev.emit("connection.update", { connection: "open" });
  await starting;

  assert.equal(typeof options.getMessage, "function", "the socket is created with a getMessage handler");
  assert.equal(await options.getMessage({ id: "never-sent" }), undefined, "an unknown message is simply not found");
  assert.equal(await options.getMessage(undefined), undefined, "a missing key never throws");

  const text = ["מחירון:", "א".repeat(300), "ב".repeat(300), "1. תספורת\n2. צבע"].join("\n\n");
  await mgr.send(ID, "972509998888", text);
  const s = sockets[0];
  assert.ok(s.sent.length >= 2, "a long answer goes out as several bubbles");
  for (const m of s.sent) {
    const back = await options.getMessage({ id: m.id });
    assert.deepEqual(back, { conversation: m.content.text }, "every bubble can be re-sent exactly as it was");
  }
});
