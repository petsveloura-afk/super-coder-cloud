/**
 * Wave 22 — the agent answers a voice note with a voice note, on every channel that can carry one.
 * Pure helpers (unit-tested): which channels, which file format, and the text that is spoken.
 */

/** Channels where the agent's spoken answer can be delivered. */
export const VOICE_CHANNELS = ["telegram", "whatsapp", "whatsapp_qr", "telegram_user"] as const;
export type VoiceChannel = (typeof VOICE_CHANNELS)[number];

export function voiceChannel(ch: string | null | undefined): ch is VoiceChannel {
  return (VOICE_CHANNELS as readonly string[]).includes(ch ?? "");
}

/** OGG/Opus (real "voice message" bubble) is recognised by its first bytes ("OggS"). */
export function isOggOpus(buf: Buffer | Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53;
}

export function voiceFileName(mime: string): string {
  return /ogg|opus/.test(mime) ? "voice.ogg" : "voice.mp3";
}

/**
 * What is spoken: no markdown, links, tool markers or emojis; button lists and long
 * lists are left to the text message (the voice note is the short, human version).
 */
export function spokenText(text: string, max = 700): string {
  const clean = text
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>|~]/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("\n"));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
}
