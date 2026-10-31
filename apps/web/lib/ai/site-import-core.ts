/**
 * Wave 59 — set the agent up from the business's website in a minute (pure, unit-tested).
 *
 * The server reads the site's pages, an AI turns the text into the agent's profile (about, services and
 * prices, hours, address, phone, FAQ, a conversation script, details to collect, menu buttons), and the
 * result only FILLS what the business has not written yet — nothing the business wrote is overwritten.
 */
import type { AgentProfile } from "./autopilot-core";

export const IMPORT_MAX_CHARS = 14_000;

/** Visible text of an HTML page (scripts, styles, menus' markup removed), whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const c = Number(n);
      return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : " ";
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Page title + meta description (a strong hint about the business). */
export function pageMeta(html: string): { title: string; description: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const description = (/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ?? "").trim().slice(0, 400);
  return { title, description };
}

/** Same-site links worth reading (about, services, prices, contact, FAQ …), max `limit`. */
export function interestingLinks(html: string, base: URL, limit = 4): string[] {
  const out: string[] = [];
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const words = /(about|service|price|pricing|menu|faq|contact|treatment|product|shop|אודות|שירות|מחיר|מחירון|תפריט|שאלות|צור.?קשר|טיפול|מוצר|حول|خدمات|اسعار|اتصل)/i;
  for (const m of html.matchAll(re)) {
    if (out.length >= limit) break;
    const href = m[1]!;
    const label = m[2]!.replace(/<[^>]+>/g, " ");
    if (!words.test(href) && !words.test(label)) continue;
    try {
      const u = new URL(href, base);
      if (u.host !== base.host || !/^https?:$/.test(u.protocol) || /\.(pdf|jpg|jpeg|png|gif|webp|zip|mp4)$/i.test(u.pathname)) continue;
      u.hash = "";
      const s = u.toString();
      if (s !== base.toString() && !out.includes(s)) out.push(s);
    } catch {
      /* not a link */
    }
  }
  return out;
}

export function importSystemPrompt(locale: string): string {
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  return [
    "You read a small business's website text and prepare the profile of its AI sales & service agent.",
    "Use ONLY facts that appear in the text — never invent prices, hours, phone numbers or services. Leave a field empty when the text has no answer.",
    `Write every value in ${lang}.`,
    "Return ONLY one JSON object (no markdown) with these keys:",
    '{"business":"2–3 sentences about the business","services":"services/products with prices, one per line","hours":"opening hours","location":"address / service area","phone":"phone","faq":"Q&A pairs from the site, lines \'ש: …\' / \'ת: …\'","pricing":"discount / payment rules written on the site","flow":["4–6 short conversation steps for this kind of business"],"fields":["2–4 details the agent should find out before closing"],"menu":["3–4 short menu buttons with an emoji"],"tone":"friendly|professional|luxury|casual"}',
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");
const list = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x, maxLen))
    .filter((x) => x.length >= 2)
    .slice(0, maxItems);

/** The AI's JSON → a clean partial profile (unknown keys dropped, everything bounded). */
export function normalizeImport(raw: unknown): Partial<AgentProfile> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tone = ["friendly", "professional", "luxury", "casual"].includes(String(r.tone)) ? (r.tone as AgentProfile["tone"]) : undefined;
  const out: Partial<AgentProfile> = {
    business: str(r.business, 1200),
    services: str(r.services, 4000),
    hours: str(r.hours, 400),
    location: str(r.location, 300),
    phone: str(r.phone, 40),
    faq: str(r.faq, 4000),
    pricing: str(r.pricing, 2000),
    flow: list(r.flow, 8, 160),
    fields: list(r.fields, 6, 80),
    menu: list(r.menu, 6, 40),
    ...(tone ? { tone } : {}),
  };
  for (const k of Object.keys(out) as (keyof AgentProfile)[]) {
    const v = out[k];
    if (v === "" || (Array.isArray(v) && !v.length)) delete out[k];
  }
  return out;
}

/** How many useful fields the import found (shown to the user). */
export function importedCount(p: Partial<AgentProfile>): number {
  return Object.keys(p).filter((k) => k !== "tone").length;
}

/**
 * Fills ONLY what is still empty in the agent's profile; the FAQ gets the site's new questions appended.
 * The website address is kept as the business's site.
 */
export function mergeImported(existing: AgentProfile, imported: Partial<AgentProfile>, website: string): { profile: AgentProfile; filled: string[] } {
  const p: AgentProfile = { ...existing };
  const filled: string[] = [];
  const textKeys = ["business", "services", "hours", "location", "phone", "pricing"] as const;
  for (const k of textKeys) {
    const v = imported[k];
    if (typeof v === "string" && v && !String(p[k] ?? "").trim()) {
      p[k] = v;
      filled.push(k);
    }
  }
  const listKeys = ["flow", "fields", "menu"] as const;
  for (const k of listKeys) {
    const v = imported[k];
    if (Array.isArray(v) && v.length && !(p[k] ?? []).filter((x) => String(x).trim()).length) {
      p[k] = v;
      filled.push(k);
    }
  }
  if (imported.faq) {
    const cur = String(p.faq ?? "").trim();
    if (!cur) {
      p.faq = imported.faq;
      filled.push("faq");
    } else if (!cur.includes(imported.faq.slice(0, 40))) {
      p.faq = `${cur}\n\n${imported.faq}`.slice(0, 6000);
      filled.push("faq");
    }
  }
  if (imported.tone && !p.tone) {
    p.tone = imported.tone;
    filled.push("tone");
  }
  if (!String(p.website ?? "").trim()) {
    p.website = website.slice(0, 300);
    filled.push("website");
  }
  return { profile: p, filled };
}
