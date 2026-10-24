import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/sessions.mjs";
import { createServer } from "../src/server.mjs";
import { formatPairCode, pairPhone } from "../src/util.mjs";

const SECRET = "s".repeat(32);
const ID = "11111111-2222-4333-8444-666666666666";
const CB = `https://app.example.com/api/channels/whatsapp_qr/${"b".repeat(48)}`;

test("phone numbers and codes for 'link with phone number'", () => {
  assert.equal(pairPhone("054-123-4567"), "972541234567");
  assert.equal(pairPhone("+972 54 123 4567"), "972541234567");
  assert.equal(pairPhone("00447911123456"), "447911123456");
  assert.equal(pairPhone("12025550123"), "12025550123");
  assert.equal(pairPhone("123"), null);
  assert.equal(pairPhone("abc"), null);
  assert.equal(formatPairCode("abcd1234"), "ABCD-1234");
  assert.equal(formatPairCode("ABCD-1234"), "ABCD-1234");
});

function fakeBaileys() {
  const sockets = [];
  return {
    sockets,
    DisconnectReason: { loggedOut: 401 },
    Browsers: { ubuntu: (n) => ["Ubuntu", n, "1"] },
    async useMultiFileAuthState() {
      return { state: { creds: {} }, saveCreds: async () => {} };
    },
    makeWASocket() {
      const ev = new EventEmitter();
      const sock = {
        ev,
        user: null,
        authState: { creds: {} },
        pairCalls: [],
        async requestPairingCode(phone) {
          sock.pairCalls.push(phone);
          return "K7Q2M9XA";
        },
        end() {
          sock.ended = true;
          ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
        },
        async sendMessage() {
          return { key: { id: "X" } };
        },
      };
      sockets.push(sock);
      // WhatsApp sends the first QR shortly after the socket opens
      setTimeout(() => ev.emit("connection.update", { qr: `2@ref${sockets.length},k` }), 30);
      return sock;
    },
  };
}

test("pairing code: request → code shown (QR rotations keep it) → linked → connected", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wap-"));
  const posts = [];
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async (u, i) => (posts.push(JSON.parse(i.body)), new Response("{}")), logger: { error() {} } });
  // a QR session was opened first (the person started on a computer), then switched to the code
  await mgr.start(ID, CB, { waitMs: 1000 });
  assert.equal(mgr.status(ID).status, "qr");
  const st = await mgr.pair(ID, CB, "054-123-4567", { waitMs: 2000 });
  assert.deepEqual({ status: st.status, code: st.code, qr: st.qr }, { status: "code", code: "K7Q2-M9XA", qr: null });
  assert.equal(baileys.sockets.length, 2, "a fresh socket for the code");
  assert.equal(baileys.sockets[0].ended, true);
  assert.deepEqual(baileys.sockets[1].pairCalls, ["972541234567"]);
  // the old socket's close event never re-opens a third socket
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(baileys.sockets.length, 2);
  // WhatsApp keeps rotating the QR in the background — the code stays on screen
  baileys.sockets[1].ev.emit("connection.update", { qr: "2@rot,k" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(mgr.status(ID).status, "code");
  // the person typed the code on the phone
  baileys.sockets[1].user = { id: "972541234567:3@s.whatsapp.net", name: "Pet Line" };
  baileys.sockets[1].ev.emit("connection.update", { connection: "open" });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(mgr.status(ID), { status: "connected", qr: null, phone: "972541234567", name: "Pet Line", error: null, code: null });
  assert.ok(posts.some((p) => p.type === "status" && p.status === "connected"));
  // asking again for a code on a connected session does nothing
  assert.equal((await mgr.pair(ID, CB, "0541234567")).status, "connected");
  assert.equal(baileys.sockets.length, 2);
});

test("pairing over HTTP: validation, invalid phone, back to QR", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "wap2-"));
  const baileys = fakeBaileys();
  const mgr = new SessionManager({ dataDir, secret: SECRET, baileys, fetchImpl: async () => new Response("{}"), logger: { error() {} } });
  const server = createServer({ manager: mgr, secret: SECRET, appUrl: "https://app.example.com" });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body) => fetch(`${base}${p}`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await call(`/sessions/${ID}/pair`, { callback: "https://evil.example.com/x", phone: "0541234567" })).status, 400);
    const bad = await call(`/sessions/${ID}/pair`, { callback: CB, phone: "12" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_phone");
    const ok = await call(`/sessions/${ID}/pair`, { callback: CB, phone: "+972541234567" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { status: "code", qr: null, phone: null, name: null, error: null, code: "K7Q2-M9XA" });
    // the person prefers the QR after all → start switches back
    const back = await (await call(`/sessions/${ID}/start`, { callback: CB })).json();
    assert.equal(back.status, "qr");
    assert.ok(back.qr.startsWith("data:image/png;base64,"));
  } finally {
    server.close();
  }
});
