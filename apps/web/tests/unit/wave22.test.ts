import { describe, expect, it } from "vitest";
import { isOggOpus, spokenText, voiceChannel, voiceFileName } from "@/lib/ai/voice-note-core";
import { unreadableMediaMarker } from "@/lib/ai/inbound-media";

describe("wave 22 — voice answers", () => {
  it("every channel that carries voice is covered (Telegram bot / Business / personal, WhatsApp QR / Cloud)", () => {
    for (const ch of ["telegram", "whatsapp", "whatsapp_qr", "telegram_user"]) expect(voiceChannel(ch)).toBe(true);
    for (const ch of ["sms", "email", "messenger", "instagram", "", null, undefined]) expect(voiceChannel(ch)).toBe(false);
  });
  it("OGG/Opus is recognised by its bytes; the file name follows the format", () => {
    expect(isOggOpus(Buffer.from("OggS\0\0\0\0"))).toBe(true);
    expect(isOggOpus(Buffer.from("ID3\u0004\0\0"))).toBe(false);
    expect(voiceFileName("audio/ogg")).toBe("voice.ogg");
    expect(voiceFileName("audio/mpeg")).toBe("voice.mp3");
  });
  it("the spoken text has no links, markdown, tags, emojis or tool markers, and ends on a sentence", () => {
    const t = spokenText("**שלום דנה!** 😊 תספורת עולה 150 ₪. [[BUTTONS: כן|לא]] פרטים: https://x.co/a <b>היום</b>");
    expect(t).toBe("שלום דנה! תספורת עולה 150 ₪. פרטים: היום");
    const long = spokenText(`${"משפט ארוך מאוד. ".repeat(80)}`, 100);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(".")).toBe(true);
  });
  it("a voice note / picture that could not be understood still gets an answer that asks to type", () => {
    expect(unreadableMediaMarker("voice", "he")).toMatch(/הודעה קולית/);
    expect(unreadableMediaMarker("ptt", "en")).toMatch(/voice message/);
    expect(unreadableMediaMarker("photo", "he")).toMatch(/תמונה/);
    expect(unreadableMediaMarker("document", "he")).toMatch(/קובץ/);
  });
});
