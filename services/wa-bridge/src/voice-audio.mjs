// Wave 56 — telephone audio helpers (pure, unit-tested): G.711 µ-law, frame energy, voice activity
// detection with an adaptive noise floor, and turn-taking decisions (end of turn, barge-in).

/** µ-law byte → 16-bit linear PCM sample. */
export function ulawToLinear(u) {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

const ULAW_TABLE = Int16Array.from({ length: 256 }, (_, i) => ulawToLinear(i));

/** 16-bit linear PCM sample → µ-law byte. */
export function linearToUlaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** RMS energy of a µ-law frame (20 ms = 160 bytes at 8 kHz). */
export function frameEnergy(ulaw) {
  if (!ulaw.length) return 0;
  let sum = 0;
  for (let i = 0; i < ulaw.length; i++) {
    const s = ULAW_TABLE[ulaw[i]];
    sum += s * s;
  }
  return Math.sqrt(sum / ulaw.length);
}

/** Adaptive voice activity detector: tracks the background noise and flags speech frames. */
export class Vad {
  constructor({ minThreshold = 550, ratio = 3.2 } = {}) {
    this.noise = 200;
    this.minThreshold = minThreshold;
    this.ratio = ratio;
  }
  threshold() {
    return Math.max(this.minThreshold, this.noise * this.ratio);
  }
  /** true when the frame is speech; quiet frames slowly update the noise floor. */
  isSpeech(energy) {
    const speech = energy > this.threshold();
    if (!speech) this.noise = this.noise * 0.95 + Math.min(energy, 4000) * 0.05;
    return speech;
  }
}

/**
 * Turn-taking: decides when the caller has finished talking and when the caller is really
 * interrupting the agent (not just "uh-huh").
 *   - a turn ends after `endSilenceMs` of silence (longer after a very short utterance — people pause
 *     after "כן…" / "רגע…" before the real sentence);
 *   - while the agent speaks, only `bargeInMs` of continuous-ish speech counts as an interruption;
 *     shorter sounds are backchannels and the agent keeps talking.
 */
export class TurnTaker {
  constructor({ frameMs = 20, endSilenceMs = 700, shortUtteranceMs = 900, shortEndSilenceMs = 1100, minSpeechMs = 240, bargeInMs = 480, gapToleranceMs = 120, maxUtteranceMs = 20_000 } = {}) {
    Object.assign(this, { frameMs, endSilenceMs, shortUtteranceMs, shortEndSilenceMs, minSpeechMs, bargeInMs, gapToleranceMs, maxUtteranceMs });
    this.reset();
  }
  reset() {
    this.inSpeech = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.totalMs = 0;
    this.runMs = 0; // continuous speech run (gaps ≤ tolerance allowed) for barge-in
    this.gapMs = 0;
  }
  /**
   * Feeds one frame. `agentSpeaking` = the agent's audio is playing.
   * Returns one of: null | "start" | "end" | "discard" | "barge-in".
   */
  feed(isSpeech, agentSpeaking) {
    const f = this.frameMs;
    if (agentSpeaking) {
      if (isSpeech) {
        this.runMs += f;
        this.gapMs = 0;
      } else {
        this.gapMs += f;
        if (this.gapMs > this.gapToleranceMs) this.runMs = 0;
      }
      if (this.runMs >= this.bargeInMs) {
        const ms = this.runMs;
        this.reset();
        this.inSpeech = true;
        this.speechMs = ms;
        this.totalMs = ms;
        return "barge-in";
      }
      return null;
    }
    if (!this.inSpeech) {
      if (isSpeech) {
        this.runMs += f;
        if (this.runMs >= 60) {
          this.inSpeech = true;
          this.speechMs = this.runMs;
          this.totalMs = this.runMs;
          this.silenceMs = 0;
          this.runMs = 0;
          return "start";
        }
      } else this.runMs = 0;
      return null;
    }
    this.totalMs += f;
    if (isSpeech) {
      this.speechMs += f;
      this.silenceMs = 0;
    } else this.silenceMs += f;
    const needSilence = this.speechMs < this.shortUtteranceMs ? this.shortEndSilenceMs : this.endSilenceMs;
    if ((this.silenceMs >= needSilence && this.speechMs >= this.minSpeechMs) || this.totalMs >= this.maxUtteranceMs) {
      this.reset();
      return "end";
    }
    if (this.silenceMs >= needSilence) {
      // a click / breath, not speech — drop what was captured
      this.reset();
      return "discard";
    }
    return null;
  }
}
