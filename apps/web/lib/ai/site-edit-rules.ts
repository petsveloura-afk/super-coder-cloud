/**
 * Wave 33 — extra rules for the "edit with the agent" prompt (pure, unit-tested).
 *
 * The shared builder prompt was written for NEW sites. Used as-is for an edit it had
 * four side effects that made edits look like they "did nothing":
 *   1. it asked for 7–16 sections and the site's language = the interface language,
 *      so edits of English sites were silently translated and short sites padded;
 *   2. it did not describe gallery / team / video sections, so the model dropped them;
 *   3. "ONLY real data, otherwise skip" meant "add testimonials / numbers / pricing"
 *      added nothing when the owner had not typed the data yet;
 *   4. empty placeholder rows were filtered out, leaving an invisible empty section.
 * These rules are appended AFTER the shared prompt and explicitly override it.
 */
export function siteEditOverrides(siteLanguage: "he" | "ar" | "en" | null): string {
  const lang = siteLanguage === "he" ? "Hebrew" : siteLanguage === "ar" ? "Arabic" : siteLanguage === "en" ? "English" : null;
  return [
    "EDIT MODE — these rules OVERRIDE anything above that conflicts with them:",
    lang
      ? `- Keep the language of the existing texts (${lang} unless the site is clearly written in another language) — change it ONLY when the instruction asks for a translation.`
      : "- Keep the language of the existing texts. Change it ONLY when the instruction asks for a translation.",
    "- Ignore the 'N-M blocks' range and the 'Structure:' advice above. Return every existing section (same order, same data) and only add / change / remove what the instruction asks for. Up to 40 sections are allowed.",
    "- Return every existing section exactly as it is unless the instruction touches it — including these types that are not described above:",
    `  {"type":"gallery","data":{"title","items":[{"url","caption"}]}}  {"type":"team","data":{"title","items":[{"name","role","image_url"}]}}  {"type":"video","data":{"title","url","text"}}  {"type":"logos","data":{"title","items":[{"name"}]}}`,
    "  Copy their url / image_url / items unchanged. Never delete a section the instruction did not mention.",
    "- When the owner explicitly asks to ADD a section (testimonials, numbers / stats, pricing, FAQ, steps, team, logos, about ...), you MUST add it — never skip it. Use real facts from the existing site when they exist.",
    "  When the facts are missing, still add the section with 2-4 clearly-labelled placeholder rows the owner can replace, written in the site's language, e.g. a testimonial quote 'Add a real customer testimonial here', name 'Customer name', a stat label 'Add your real number', a price left empty. NEVER invent real-sounding people, reviews, numbers, prices or client names.",
    "  Every row you add must have at least one non-empty text field.",
    "- Return ONLY the JSON object (no markdown, no commentary), as compact as possible.",
  ].join("\n");
}

/** Guess the language a site is written in from its visible texts (Hebrew / Arabic / English), or null when unclear. */
export function detectSiteLanguage(texts: string[]): "he" | "ar" | "en" | null {
  const s = texts.join(" ");
  const he = (s.match(/[֐-׿]/g) ?? []).length;
  const ar = (s.match(/[؀-ۿ]/g) ?? []).length;
  const en = (s.match(/[A-Za-z]/g) ?? []).length;
  const top = Math.max(he, ar, en);
  if (top < 12) return null;
  return top === he ? "he" : top === ar ? "ar" : "en";
}

/** All visible strings of a site's blocks (for language detection). */
export function blockTexts(blocks: { data: unknown }[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (!/^(https?:|#|mailto:|tel:|\/)/.test(v)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  blocks.forEach((b) => walk(b.data));
  return out;
}
