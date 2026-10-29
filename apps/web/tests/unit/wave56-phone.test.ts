import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dropRepeats, isBackchannel, isCorrection, isRepeatReply, notHeardLine, phoneLang, phoneStyleRules, phoneSystemPrompt, sentenceSimilarity, silenceLine, soundsUnfinished, spokenTurn, spokenWhen, summaryPrompt } from "@/lib/voice/phone-brain-core";
import { Pcm24kToUlaw8k, bridgeStreamUrl, linearToUlaw, signStream, speechRatio, streamTwiml, ulawToLinear, ulawToWav, verifyStream } from "@/lib/voice/realtime-core";
import { gatherPlayTwiml, playTwiml } from "@/lib/voice/twiml";

describe("wave 56 — phone manners", () => {
  it("style rules cover turn-taking, no repetition, no-ego correction, expertise", () => {
    const r = phoneStyleRules("he");
    for (const s of ["SHORT", "NEVER repeat", "without ego", "senior expert", "One question per turn"]) expect(r).toContain(s);
    const p = phoneSystemPrompt({ lang: "he", agentName: "נועה", orgName: "מספרה", direction: "out", businessInstructions: "x", businessData: "", sections: ["EXTRA SECTION", ""], callerKnown: true });
    expect(p).toContain("YOU called the customer");
    expect(p).toContain("EXTRA SECTION");
    expect(p).toContain("use what you remember");
  });

  it("backchannels are not interruptions; corrections are recognised", () => {
    for (const b of ["כן", "אהה", "אוקיי.", "uh-huh", "mm", "تمام"]) expect(isBackchannel(b)).toBe(true);
    expect(isBackchannel("כן, אבל כמה זה עולה?")).toBe(false);
    for (const c of ["לא, אמרתי יום שלישי", "טעית", "no, I said Tuesday", "that's wrong"]) expect(isCorrection(c)).toBe(true);
    expect(isCorrection("נשמע טוב")).toBe(false);
  });

  it("unfinished utterances wait; finished ones answer", () => {
    expect(soundsUnfinished("רציתי לשאול אם")).toBe(false);
    expect(soundsUnfinished("רציתי לשאול ו")).toBe(true);
    expect(soundsUnfinished("I wanted to ask about the price and")).toBe(true);
    expect(soundsUnfinished("כמה זה עולה?")).toBe(false);
  });

  it("never repeats itself word for word", () => {
    const prev = ["החבילה הבסיסית עולה 990 שקל לחודש וכוללת הכול.", "מתי נוח לך להיפגש?"];
    const r = dropRepeats("החבילה הבסיסית עולה 990 שקל לחודש וכוללת הכול. רוצה שאשריין לך מקום?", prev);
    expect(r.text).toBe("רוצה שאשריין לך מקום?");
    expect(r.dropped).toBe(1);
    expect(isRepeatReply("מתי נוח לך להיפגש?", prev)).toBe(true);
    expect(isRepeatReply("ביום שלישי בבוקר מתאים?", prev)).toBe(false);
    expect(sentenceSimilarity("a b c d", "a b c d")).toBe(1);
  });

  it("spoken turns are short and clean", () => {
    expect(spokenTurn("**היי** 😊 [[TAG: vip]] כנסו https://x.co")).toBe("היי כנסו");
    const long = Array.from({ length: 80 }, (_, i) => `מילה${i}`).join(" ");
    expect(spokenTurn(long).split(" ").length).toBeLessThanOrEqual(46);
    expect(silenceLine("he", 1).end).toBe(false);
    expect(silenceLine("en", 2).end).toBe(true);
    expect(notHeardLine("he", 0)).not.toBe(notHeardLine("he", 1));
    expect(phoneLang("fr")).toBe("he");
    expect(summaryPrompt("en")).toContain("English");
  });

  it("booked time is said the way people say it", () => {
    const he = spokenWhen("2026-11-03T08:00:00.000Z", "he", "Asia/Jerusalem");
    expect(he).toContain("10:00");
    expect(he).toMatch(/שלישי/);
    expect(spokenWhen("2026-11-03T08:00:00.000Z", "en", "Asia/Jerusalem")).toMatch(/Tuesday.*10:00/);
  });
});

describe("wave 56 — telephone audio + live stream", () => {
  it("µ-law, WAV for speech-to-text, speech ratio", () => {
    expect(Math.abs(ulawToLinear(linearToUlaw(8000)) - 8000)).toBeLessThan(400);
    const loud = new Uint8Array(1600).fill(linearToUlaw(9000));
    const quiet = new Uint8Array(1600).fill(0xff);
    const wav = ulawToWav(loud);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.length).toBe(44 + 3200);
    expect(speechRatio(loud)).toBe(1);
    expect(speechRatio(quiet)).toBe(0);
  });

  it("24 kHz PCM → 8 kHz µ-law, across chunk boundaries", () => {
    const pcm = Buffer.alloc(24000 * 2);
    for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((i / 24000) * 2 * Math.PI * 300)), i * 2);
    const c = new Pcm24kToUlaw8k();
    const parts = [c.push(pcm.subarray(0, 1001)), c.push(pcm.subarray(1001, 30001)), c.push(pcm.subarray(30001))];
    expect(parts.reduce((a, p) => a + p.length, 0)).toBe(8000);
  });

  it("stream parameters, URL and TwiML", () => {
    const secret = "x".repeat(32);
    const p = signStream(secret, "11111111-2222-3333-4444-555555555555");
    expect(verifyStream(secret, p)).toBe(true);
    expect(verifyStream(secret, { ...p, sig: "0".repeat(64) })).toBe(false);
    expect(verifyStream(secret, signStream(secret, p.call, Date.now() - 20 * 60_000))).toBe(false);
    expect(bridgeStreamUrl("https://wa-bridge.up.railway.app")).toBe("wss://wa-bridge.up.railway.app/voice/stream");
    expect(bridgeStreamUrl("not a url")).toBeNull();
    const tw = streamTwiml("wss://b/voice/stream", { call: p.call, sig: 'a"b' });
    expect(tw).toContain('<Connect><Stream url="wss://b/voice/stream">');
    expect(tw).toContain('value="a&quot;b"');
    expect(tw).toMatch(/<\/Connect><Hangup\/><\/Response>$/);
  });

  it("own-voice TwiML keeps barge-in and the fallbacks", () => {
    const g = gatherPlayTwiml("https://app/api/voice/clip/1", "https://app/turn?call=1&x=2", "he", { hangupText: "ביי" });
    expect(g).toContain('<Gather input="speech" language="he-IL"');
    expect(g).toContain("<Play>https://app/api/voice/clip/1</Play></Gather>");
    expect(g).toContain("turn?call=1&amp;x=2");
    expect(playTwiml("https://c", { dialTo: "+972501234567" })).toContain("<Dial timeout=\"25\">+972501234567</Dial>");
    expect(playTwiml("https://c", { dialTo: "bad" })).toContain("<Hangup/>");
  });
});

describe("wave 56 — migration is additive", () => {
  const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261030000001_voice_live_calls.sql"), "utf8");
  it("adds the clips table (server only) and the call mode", () => {
    expect(sql).toMatch(/create table if not exists public\.voice_clips/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/add column if not exists mode text not null default 'turn'/);
    expect(sql).not.toMatch(/drop table|drop column/i);
  });
});
