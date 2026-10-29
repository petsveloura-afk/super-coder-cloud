/**
 * Wave 56 — live phone calls (pure parts, unit-tested): telephone audio (G.711 µ-law 8 kHz) for
 * speech-to-text and text-to-speech, the signed stream parameters and the TwiML that connects a call
 * to the bridge's live audio stream.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function ulawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

export function linearToUlaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** µ-law 8 kHz → a 16-bit PCM WAV file (what speech-to-text engines accept). */
export function ulawToWav(ulaw: Uint8Array): Buffer {
  const data = Buffer.alloc(ulaw.length * 2);
  for (let i = 0; i < ulaw.length; i++) data.writeInt16LE(ulawToLinear(ulaw[i]!), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Share of frames that contain speech (rough check before paying for speech-to-text). */
export function speechRatio(ulaw: Uint8Array, frame = 160, threshold = 550): number {
  let speech = 0;
  let frames = 0;
  for (let i = 0; i + frame <= ulaw.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) {
      const s = ulawToLinear(ulaw[j]!);
      sum += s * s;
    }
    frames++;
    if (Math.sqrt(sum / frame) > threshold) speech++;
  }
  return frames ? speech / frames : 0;
}

/**
 * Streaming converter: 16-bit little-endian PCM at 24 kHz (OpenAI "pcm") → µ-law 8 kHz.
 * Averages every 3 samples (simple low-pass + decimation) and keeps leftovers between chunks.
 */
export class Pcm24kToUlaw8k {
  private carry = Buffer.alloc(0);
  push(chunk: Uint8Array): Buffer {
    const buf = this.carry.length ? Buffer.concat([this.carry, Buffer.from(chunk)]) : Buffer.from(chunk);
    const usable = buf.length - (buf.length % 6); // 3 samples × 2 bytes
    const out = Buffer.alloc(usable / 6);
    for (let i = 0, o = 0; i < usable; i += 6, o++) {
      const avg = Math.round((buf.readInt16LE(i) + buf.readInt16LE(i + 2) + buf.readInt16LE(i + 4)) / 3);
      out[o] = linearToUlaw(avg);
    }
    this.carry = buf.subarray(usable);
    return out;
  }
}

/** HMAC of the stream parameters (the bridge checks it; valid for 15 minutes). */
export function signStream(secret: string, callId: string, now = Date.now()): { call: string; ts: string; sig: string } {
  const ts = String(now);
  return { call: callId, ts, sig: createHmac("sha256", secret).update(`${callId}.${ts}`).digest("hex") };
}

export function verifyStream(secret: string, p: { call?: string; ts?: string; sig?: string }, now = Date.now()): boolean {
  if (!secret || secret.length < 24 || !p.call || !p.ts || !p.sig) return false;
  if (Math.abs(now - Number(p.ts)) > 15 * 60_000) return false;
  const a = Buffer.from(createHmac("sha256", secret).update(`${p.call}.${p.ts}`).digest("hex"));
  const b = Buffer.from(p.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** https://bridge.example.com → wss://bridge.example.com/voice/stream */
export function bridgeStreamUrl(bridgeUrl: string): string | null {
  try {
    const u = new URL(bridgeUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = `${u.pathname.replace(/\/$/, "")}/voice/stream`;
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** TwiML: connect the call to the live audio stream; hang up when the stream ends. */
export function streamTwiml(streamUrl: string, params: Record<string, string>): string {
  const ps = Object.entries(params)
    .map(([k, v]) => `<Parameter name="${esc(k)}" value="${esc(v)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${esc(streamUrl)}">${ps}</Stream></Connect><Hangup/></Response>`;
}
