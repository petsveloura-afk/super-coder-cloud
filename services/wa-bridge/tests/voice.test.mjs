// Wave 56 — live phone calls: WebSocket framing, µ-law, turn-taking, signatures and a full call
// against a stand-in web app (turn → tts → mark → barge-in → end).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { acceptKey, encodeFrame, FrameParser } from "../src/ws.mjs";
import { frameEnergy, linearToUlaw, TurnTaker, ulawToLinear, Vad } from "../src/voice-audio.mjs";
import { verifyStreamParams } from "../src/voice-realtime.mjs";
import { attachVoiceStream } from "../src/server.mjs";

const SECRET = "s".repeat(32);

test("websocket handshake key (RFC 6455 example)", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("frames: masked client frames, long payloads, fragments", () => {
  const got = [];
  const p = new FrameParser((f) => got.push(f));
  const payload = Buffer.from("x".repeat(70_000));
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
  const header = Buffer.alloc(14);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  mask.copy(header, 10);
  const frame = Buffer.concat([header, masked]);
  p.push(frame.subarray(0, 5));
  p.push(frame.subarray(5));
  assert.equal(got.length, 1);
  assert.equal(got[0].payload.toString(), payload.toString());
  const small = encodeFrame("hi");
  assert.deepEqual([...small], [0x81, 2, 0x68, 0x69]);
  assert.throws(() => new FrameParser(() => {}, { maxPayload: 10 }).push(encodeFrame("x".repeat(200))));
});

test("µ-law round trip and energy", () => {
  for (const s of [0, 100, -100, 1000, -5000, 20000, -32000]) {
    const back = ulawToLinear(linearToUlaw(s));
    assert.ok(Math.abs(back - s) <= Math.max(16, Math.abs(s) * 0.07), `${s} → ${back}`);
  }
  const silence = Buffer.alloc(160, 0xff);
  const loud = Buffer.alloc(160, linearToUlaw(8000));
  assert.ok(frameEnergy(silence) < 50);
  assert.ok(frameEnergy(loud) > 5000);
  const vad = new Vad();
  assert.equal(vad.isSpeech(frameEnergy(silence)), false);
  assert.equal(vad.isSpeech(frameEnergy(loud)), true);
});

test("turn-taking: end of turn, short-utterance patience, backchannel vs barge-in, clicks", () => {
  const t = new TurnTaker();
  const feed = (speech, n, agent = false) => {
    let ev = null;
    for (let i = 0; i < n; i++) ev = t.feed(speech, agent) ?? ev;
    return ev;
  };
  assert.equal(feed(true, 5), "start");
  feed(true, 60); // 1.2 s of speech
  assert.equal(feed(false, 34), null); // 680 ms silence: not yet
  assert.equal(feed(false, 2), "end"); // 720 ms → end
  // a short "כן…" then a pause: waits longer (1.1 s) before deciding
  feed(true, 20);
  assert.equal(feed(false, 40), null);
  assert.equal(feed(false, 16), "end");
  // while the agent speaks: "uh-huh" (300 ms) is ignored, 500 ms is a real interruption
  assert.equal(feed(true, 15, true), null);
  assert.equal(feed(false, 10, true), null);
  assert.equal(feed(true, 25, true), "barge-in");
  // a click: too short to be speech → discarded
  const c = new TurnTaker();
  for (let i = 0; i < 4; i++) c.feed(true, false);
  let last = null;
  for (let i = 0; i < 60; i++) last = c.feed(false, false) ?? last;
  assert.equal(last, "discard");
});

test("stream parameters are signed and expire", () => {
  const call = "11111111-2222-3333-4444-555555555555";
  const ts = String(Date.now());
  const sig = createHmac("sha256", SECRET).update(`${call}.${ts}`).digest("hex");
  assert.equal(verifyStreamParams({ call, ts, sig }, SECRET), true);
  assert.equal(verifyStreamParams({ call, ts, sig: sig.replace(/^./, "0") }, SECRET), false);
  assert.equal(verifyStreamParams({ call, ts: String(Date.now() - 20 * 60_000), sig }, SECRET), false);
});

test("a live call: greeting → caller speaks → answer → barge-in clears → goodbye hangs up", async () => {
  const hits = [];
  const app = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const sigOk = req.headers["x-scc-signature"] === createHmac("sha256", SECRET).update(`${req.headers["x-scc-timestamp"]}.${Buffer.concat(chunks).toString()}`).digest("hex");
    hits.push({ path: req.url, body, sigOk });
    if (req.url === "/api/voice/realtime/turn") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const n = hits.filter((h) => h.path === req.url).length;
      return res.end(JSON.stringify(n === 1 ? { say: "שלום!" } : n === 2 ? { say: "מעולה, נקבע.", heard: true } : { say: "תודה, יום נעים", end: true }));
    }
    if (req.url === "/api/voice/realtime/tts") {
      res.writeHead(200, { "Content-Type": "audio/basic" });
      res.write(Buffer.alloc(800, 0x7f));
      return res.end(Buffer.alloc(400, 0x7f));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => app.listen(0, r));
  const appUrl = `http://127.0.0.1:${app.address().port}`;
  const bridge = http.createServer((_q, s) => s.end());
  attachVoiceStream(bridge, { secret: SECRET, appUrl, log: () => {} });
  await new Promise((r) => bridge.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/voice/stream`);
  const got = [];
  const waitFor = async (pred, ms = 12000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const hit = got.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("timeout");
  };
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  const call = "11111111-2222-3333-4444-555555555555";
  const ts = String(Date.now());
  const sig = createHmac("sha256", SECRET).update(`${call}.${ts}`).digest("hex");
  ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZ1", callSid: "CA1", customParameters: { call, ts, sig } } }));
  const media = (payload) => ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: payload.toString("base64") } }));
  const loud = Buffer.alloc(160, linearToUlaw(9000));
  const quiet = Buffer.alloc(160, 0xff);

  // 1) greeting is spoken (media + a mark)
  const mark1 = await waitFor((m) => m.event === "mark");
  assert.ok(got.some((m) => m.event === "media" && m.streamSid === "MZ1"));
  ws.send(JSON.stringify({ event: "mark", mark: { name: mark1.mark.name } }));
  // 2) the caller speaks 1.2 s then is silent → one utterance goes to the brain
  for (let i = 0; i < 60; i++) media(loud);
  for (let i = 0; i < 45; i++) media(quiet);
  await waitFor(() => hits.some((h) => h.path === "/api/voice/realtime/turn" && h.body.kind === "utterance"));
  const utt = hits.find((h) => h.body.kind === "utterance");
  assert.ok(utt.sigOk && utt.body.callId === call && utt.body.audio.length > 1000);
  // 3) the answer plays; the caller interrupts → Twilio's buffer is cleared
  await waitFor((m) => m.event === "mark" && m.mark.name !== mark1.mark.name);
  for (let i = 0; i < 30; i++) media(loud);
  await waitFor((m) => m.event === "clear");
  // 4) the caller finishes (a short interruption → the agent waits the longer pause) → goodbye → end posted → the stream closes
  for (let i = 0; i < 60; i++) media(quiet);
  const mark3 = await waitFor((m) => m.event === "mark" && hits.filter((h) => h.body.kind === "utterance").length >= 2 && m.mark.name === "m3");
  const closed = new Promise((r) => (ws.onclose = r));
  ws.send(JSON.stringify({ event: "mark", mark: { name: mark3.mark.name } }));
  await closed;
  await waitFor(() => hits.some((h) => h.path === "/api/voice/realtime/end"));
  assert.equal(hits.filter((h) => h.path === "/api/voice/realtime/end").length, 1);
  assert.ok(hits.every((h) => h.sigOk));
  bridge.close();
  app.close();
});

test("a stream with a bad signature is rejected", async () => {
  const bridge = http.createServer((_q, s) => s.end());
  attachVoiceStream(bridge, { secret: SECRET, appUrl: "http://127.0.0.1:1", log: () => {} });
  await new Promise((r) => bridge.listen(0, r));
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/voice/stream`);
  await new Promise((r) => (ws.onopen = r));
  const closed = new Promise((r) => (ws.onclose = (e) => r(e.code)));
  ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZ", customParameters: { call: "11111111-2222-3333-4444-555555555555", ts: String(Date.now()), sig: "bad" } } }));
  assert.equal(await closed, 1008);
  bridge.close();
});
