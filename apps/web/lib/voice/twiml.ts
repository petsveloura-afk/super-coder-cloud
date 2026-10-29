/**
 * Wave 16 — phone calls (Twilio) — pure helpers, unit-tested.
 * The AI voice agent: Twilio recognises the caller's speech (<Gather input="speech">),
 * the agent answers, Twilio reads the answer aloud (<Say>) and listens again.
 */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function voiceLang(locale: string): { language: string; voice: string } {
  if (locale === "en") return { language: "en-US", voice: "Google.en-US-Neural2-F" };
  if (locale === "ar") return { language: "ar-XA", voice: "Google.ar-XA-Standard-A" };
  return { language: "he-IL", voice: "Google.he-IL-Standard-A" };
}

/** Text for speech: no links, markdown, emojis or tool markers; short. */
export function speakable(text: string, max = 600): string {
  return text
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>|~]/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Say the text, then listen for the caller (speech), posting the result to `action`. */
export function gatherTwiml(say: string, action: string, locale: string, opts: { timeout?: number; hangupText?: string } = {}): string {
  const { language, voice } = voiceLang(locale);
  const s = xmlEscape(speakable(say));
  const bye = opts.hangupText ? `<Say language="${language}" voice="${voice}">${xmlEscape(speakable(opts.hangupText))}</Say><Hangup/>` : "<Hangup/>";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" language="${language}" speechTimeout="auto" timeout="${opts.timeout ?? 6}" action="${xmlEscape(action)}" method="POST"><Say language="${language}" voice="${voice}">${s}</Say></Gather>${bye}</Response>`;
}

export function sayTwiml(say: string, locale: string, opts: { dialTo?: string | null } = {}): string {
  const { language, voice } = voiceLang(locale);
  const dial = opts.dialTo && /^\+\d{8,15}$/.test(opts.dialTo) ? `<Dial timeout="25">${xmlEscape(opts.dialTo)}</Dial>` : "<Hangup/>";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${language}" voice="${voice}">${xmlEscape(speakable(say))}</Say>${dial}</Response>`;
}

/** The caller wants to stop / end the call. */
export function isGoodbye(text: string): boolean {
  // \b does not work after Hebrew / Arabic letters: end = end of text or punctuation / space
  return /^(?:ביי|להתראות|תודה\s+ביי|זהו\s+תודה|סיימנו|bye|goodbye|that's all|thanks,? bye|مع السلامة|باي)(?=$|[\s.,!?…])/i.test(text.trim());
}

/** The caller asks for a person. */
export function wantsPersonOnPhone(text: string): boolean {
  return /נציג|בן\s*אדם|מישהו\s+אנושי|מנהל|agent|human|representative|person|موظف|إنسان/i.test(text);
}

export function escalationText(locale: string, input: { org: string; customer: string; reason: string }): string {
  if (locale === "en") return `Urgent from ${input.org}: ${input.customer} needs a person now. ${input.reason}. Please check the inbox.`;
  if (locale === "ar") return `عاجل من ${input.org}: ${input.customer} يحتاج موظفاً الآن. ${input.reason}. يرجى فتح صندوق الرسائل.`;
  return `הודעה דחופה מ${input.org}: ${input.customer} מבקש נציג עכשיו. ${input.reason}. כנסו לתיבת ההודעות.`;
}

/**
 * Wave 56 — the agent's own voice on turn-by-turn calls: play the clip (ElevenLabs / OpenAI) inside the
 * <Gather>, so the caller can still interrupt it by speaking (barge-in), then listen again.
 */
export function gatherPlayTwiml(audioUrl: string, action: string, locale: string, opts: { timeout?: number; hangupText?: string; hangupUrl?: string | null } = {}): string {
  const { language, voice } = voiceLang(locale);
  const bye = opts.hangupUrl
    ? `<Play>${xmlEscape(opts.hangupUrl)}</Play><Hangup/>`
    : opts.hangupText
      ? `<Say language="${language}" voice="${voice}">${xmlEscape(speakable(opts.hangupText))}</Say><Hangup/>`
      : "<Hangup/>";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" language="${language}" speechTimeout="auto" timeout="${opts.timeout ?? 6}" action="${xmlEscape(action)}" method="POST"><Play>${xmlEscape(audioUrl)}</Play></Gather>${bye}</Response>`;
}

/** Plays the agent's last words (own voice), then transfers to the team member or hangs up. */
export function playTwiml(audioUrl: string, opts: { dialTo?: string | null } = {}): string {
  const dial = opts.dialTo && /^\+\d{8,15}$/.test(opts.dialTo) ? `<Dial timeout="25">${xmlEscape(opts.dialTo)}</Dial>` : "<Hangup/>";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${xmlEscape(audioUrl)}</Play>${dial}</Response>`;
}
