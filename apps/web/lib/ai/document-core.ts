/**
 * Wave 16 — reading documents customers send (pure helpers, unit-tested).
 * A PDF (price quote from a competitor, ID-free forms, a plan, a menu…) is read by
 * Gemini (native PDF input) or Claude (document block); a .txt file is read as-is.
 */
export const DOC_MAX_BYTES = 6 * 1024 * 1024;

export function isPdfBuffer(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

export function documentKind(buf: Uint8Array, mime: string, name?: string): "pdf" | "text" | null {
  if (isPdfBuffer(buf)) return "pdf";
  if (/^text\/plain/.test(mime) || /\.txt$/i.test(name ?? "")) return "text";
  return null;
}

export function documentPrompt(locale: string, name?: string): string {
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  return [
    `A customer sent this document${name ? ` ("${name.slice(0, 120)}")` : ""} in a chat with a business.`,
    `In ${lang}, write a short summary for the business's sales agent (max 8 lines):`,
    "what the document is, the key facts (amounts, dates, items, requests), and what the customer probably wants.",
    "Never copy ID numbers, card numbers, bank accounts or passwords — write [hidden] instead.",
    "Output only the summary.",
  ].join(" ");
}

/** Plain-text files: no AI needed; trimmed and with obvious card / ID numbers masked. */
export function readPlainText(buf: Uint8Array, max = 3000): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/\u0000/g, "").trim();
  return maskSecrets(text).slice(0, max);
}

export function maskSecrets(text: string): string {
  return text
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, "[hidden]") // card-like numbers
    .replace(/\b\d{9}\b/g, "[hidden]"); // Israeli ID-like numbers
}
