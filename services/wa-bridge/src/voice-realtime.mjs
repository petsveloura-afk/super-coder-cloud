// Wave 56 — live phone calls (Twilio Media Streams) like Vapi / Retell:
//   caller audio streams in continuously → voice activity + smart turn-taking → the web app's phone brain
//   (speech-to-text + the full sales brain) → the agent's own voice streamed back (µ-law 8 kHz).
//   • the caller can interrupt the agent (barge-in) — short "uh-huh"s do NOT stop it (backchannels);
//   • if the caller continues talking while the agent is still thinking, the pending answer is
//     dropped and both parts are understood together (no talking over people);
//   • silence: one gentle check, then a polite goodbye;
//   • transfer to a person and hang-up are done by the web app (Twilio REST) after the last words.
// The web app keeps every key (AI, ElevenLabs, OpenAI); the bridge only moves audio.
import { createHmac, timingSafeEqual } from "node:crypto";
import { frameEnergy, TurnTaker, Vad } from "./voice-audio.mjs";
import { sign } from "./util.mjs";

const FRAME_BYTES = 160; // 20 ms of µ-law at 8 kHz
const PREROLL_FRAMES = 15; // 300 ms kept before speech starts
const SILENCE_PROMPT_MS = 8000;

/** HMAC of the stream parameters, set by the web app in the TwiML (valid for 15 minutes). */
export function verifyStreamParams(params, secret, now = Date.now()) {
  if (!params || !secret || secret.length < 24) return false;
  const { call, ts, sig } = params;
  if (!/^[0-9a-f-]{36}$/.test(String(call ?? "")) || !/^\d{10,14}$/.test(String(ts ?? "")) || typeof sig !== "string") return false;
  if (Math.abs(now - Number(ts)) > 15 * 60_000) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${call}.${ts}`).digest("hex"));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function postJson(appUrl, secret, path, body, signal) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${appUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...sign(secret, raw) }, body: raw, signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}_${res.status}`);
  return data;
}

export class VoiceSession {
  constructor(ws, { secret, appUrl, log = () => {} }) {
    this.ws = ws;
    this.secret = secret;
    this.appUrl = appUrl;
    this.log = log;
    this.vad = new Vad();
    this.turns = new TurnTaker();
    this.streamSid = null;
    this.callId = null;
    this.ready = false;
    this.preroll = [];
    this.capture = [];
    this.pendingAudio = []; // audio of an utterance whose answer was cancelled (caller kept talking)
    this.speaking = false; // agent audio is playing
    this.thinking = null; // AbortController of the pending turn
    this.ttsAbort = null;
    this.markSeq = 0;
    this.awaitMark = null;
    this.silenceTimer = null;
    this.silenceCount = 0;
    this.notHeard = 0;
    this.endAfterSpeech = null; // "end" | "transfer"
    this.closed = false;
    this.turnSeq = 0;
    ws.on("message", (m) => this.onMessage(m));
    ws.on("close", () => this.finish());
    this.authTimer = setTimeout(() => {
      if (!this.ready) ws.close(1008, "no start");
    }, 10_000);
  }

  send(obj) {
    return this.ws.send(JSON.stringify(obj));
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.event === "start") return this.onStart(msg.start ?? {});
    if (!this.ready) return;
    if (msg.event === "media" && msg.media?.payload && (msg.media.track ?? "inbound") === "inbound") return this.onAudio(Buffer.from(msg.media.payload, "base64"));
    if (msg.event === "mark") return this.onMark(String(msg.mark?.name ?? ""));
    if (msg.event === "stop") return this.finish();
  }

  onStart(start) {
    const params = start.customParameters ?? {};
    if (!verifyStreamParams(params, this.secret)) {
      this.log("voice: bad stream signature");
      return this.ws.close(1008, "forbidden");
    }
    clearTimeout(this.authTimer);
    this.ready = true;
    this.streamSid = start.streamSid;
    this.callId = params.call;
    void this.runTurn({ kind: "start" });
  }

  onAudio(buf) {
    for (let i = 0; i < buf.length; i += FRAME_BYTES) this.onFrame(buf.subarray(i, i + FRAME_BYTES));
  }

  onFrame(frame) {
    const speech = this.vad.isSpeech(frameEnergy(frame));
    const ev = this.turns.feed(speech, this.speaking);
    if (this.speaking || !this.turns.inSpeech) {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    if (ev === "barge-in") {
      // the caller really interrupts: stop talking immediately and listen
      this.stopSpeaking();
      this.endAfterSpeech = null;
      this.capture = [...this.preroll];
      this.preroll = [];
      return;
    }
    if (ev === "start") {
      this.clearSilenceTimer();
      // the caller paused mid-sentence and goes on → keep the first part and understand it all together
      if (this.waitTimer) {
        clearTimeout(this.waitTimer);
        this.waitTimer = null;
      }
      // the caller continues while the agent is still thinking → drop that answer, understand both parts together
      if (this.thinking) {
        this.thinking.abort();
        this.thinking = null;
        this.pendingAudio = this.lastUtterance ?? [];
      }
      this.capture = [...this.preroll, frame];
      this.preroll = [];
      return;
    }
    if (this.turns.inSpeech && !this.speaking) {
      this.capture.push(frame);
      return;
    }
    if (ev === "discard") {
      this.capture = [];
      return;
    }
    if (ev === "end") {
      this.capture.push(frame);
      const audio = [...this.pendingAudio, ...this.capture];
      this.pendingAudio = [];
      this.capture = [];
      this.lastUtterance = audio;
      void this.runTurn({ kind: "utterance", audio: Buffer.concat(audio).toString("base64") });
    }
  }

  async runTurn(body) {
    if (this.closed) return;
    const seq = ++this.turnSeq;
    const ctrl = new AbortController();
    this.thinking = ctrl;
    let r;
    try {
      r = await postJson(this.appUrl, this.secret, "/api/voice/realtime/turn", { callId: this.callId, notHeard: this.notHeard, silence: this.silenceCount, ...body }, AbortSignal.any([ctrl.signal, AbortSignal.timeout(25_000)]));
    } catch (e) {
      if (ctrl.signal.aborted || seq !== this.turnSeq) return;
      this.log("voice: turn failed", e.message);
      r = { say: "", end: false };
    }
    if (seq !== this.turnSeq || this.closed) return;
    this.thinking = null;
    if (r.wait && body.kind === "utterance") {
      // the sentence sounded unfinished ("…and", "…but") → give the caller a moment to continue
      this.pendingAudio = this.lastUtterance ?? [];
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null;
        const audio = this.pendingAudio;
        this.pendingAudio = [];
        if (!this.closed && audio.length) void this.runTurn({ kind: "utterance", audio: Buffer.concat(audio).toString("base64"), force: true });
      }, 1600);
      return;
    }
    if (r.heard === false) this.notHeard++;
    else if (body.kind === "utterance") this.notHeard = 0;
    if (body.kind !== "silence") this.silenceCount = 0;
    this.endAfterSpeech = r.transfer ? "transfer" : r.end ? "end" : null;
    if (r.say) await this.speak(r.say, seq);
    else if (this.endAfterSpeech) this.afterSpeech();
    else this.armSilenceTimer();
  }

  async speak(text, seq) {
    const ctrl = new AbortController();
    this.ttsAbort = ctrl;
    this.speaking = true;
    this.turns.reset();
    let sent = 0;
    try {
      const raw = JSON.stringify({ callId: this.callId, text });
      const res = await fetch(`${this.appUrl}/api/voice/realtime/tts`, { method: "POST", headers: { "Content-Type": "application/json", ...sign(this.secret, raw) }, body: raw, signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(30_000)]) });
      if (!res.ok || !res.body) throw new Error(`tts_${res.status}`);
      let carry = Buffer.alloc(0);
      for await (const chunk of res.body) {
        if (ctrl.signal.aborted || seq !== this.turnSeq) return;
        carry = Buffer.concat([carry, Buffer.from(chunk)]);
        const whole = carry.length - (carry.length % FRAME_BYTES);
        if (whole > 0) {
          this.send({ event: "media", streamSid: this.streamSid, media: { payload: carry.subarray(0, whole).toString("base64") } });
          sent += whole;
          carry = carry.subarray(whole);
        }
      }
      if (carry.length) {
        this.send({ event: "media", streamSid: this.streamSid, media: { payload: carry.toString("base64") } });
        sent += carry.length;
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.log("voice: tts failed", e.message);
    }
    if (ctrl.signal.aborted || seq !== this.turnSeq) return;
    this.ttsAbort = null;
    if (!sent) {
      this.speaking = false;
      if (this.endAfterSpeech) this.afterSpeech();
      else this.armSilenceTimer();
      return;
    }
    const name = `m${++this.markSeq}`;
    this.awaitMark = name;
    this.send({ event: "mark", streamSid: this.streamSid, mark: { name } });
  }

  onMark(name) {
    if (name !== this.awaitMark) return;
    this.awaitMark = null;
    this.speaking = false;
    this.turns.reset();
    if (this.endAfterSpeech) this.afterSpeech();
    else this.armSilenceTimer();
  }

  stopSpeaking() {
    this.ttsAbort?.abort();
    this.ttsAbort = null;
    this.awaitMark = null;
    this.speaking = false;
    this.turnSeq++; // anything still in flight for the old answer is ignored
    this.thinking = null;
    if (this.streamSid) this.send({ event: "clear", streamSid: this.streamSid });
  }

  armSilenceTimer() {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.closed || this.speaking || this.thinking || this.turns.inSpeech) return;
      this.silenceCount++;
      void this.runTurn({ kind: "silence" });
    }, SILENCE_PROMPT_MS);
  }

  clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  afterSpeech() {
    const what = this.endAfterSpeech;
    this.endAfterSpeech = null;
    void postJson(this.appUrl, this.secret, "/api/voice/realtime/end", { callId: this.callId, transfer: what === "transfer" }, AbortSignal.timeout(15_000))
      .catch((e) => this.log("voice: end failed", e.message))
      .finally(() => {
        this.ended = true;
        // transfer: the web app redirects the call (Twilio REST) — the stream ends by itself; end: hang up
        if (what === "end") this.ws.close(1000, "done");
      });
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.clearSilenceTimer();
    this.thinking?.abort();
    this.ttsAbort?.abort();
    if (this.ready && !this.ended) {
      this.ended = true;
      void postJson(this.appUrl, this.secret, "/api/voice/realtime/end", { callId: this.callId, transfer: false, hungUp: true }, AbortSignal.timeout(15_000)).catch(() => undefined);
    }
    if (this.ws.open) this.ws.close(1000, "");
  }
}
