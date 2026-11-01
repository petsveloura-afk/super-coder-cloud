/**
 * The site agent's tools — pure part (no I/O, unit-tested).
 *
 * Before: the model wrote a site from the brief alone. Now the agent works like a studio:
 *   1. business facts  — the real name, contact details, products & prices, real customer reviews, knowledge
 *                        articles and social links are given to the model ("use exactly, never invent")
 *   2. real content    — contact block / settings / testimonials / pricing are filled from those facts
 *   3. free images     — every image slot (hero, about, gallery) gets a fitting free photo (Pexels / Pixabay /
 *                        Openverse, same keys as the post studio) when the plan has no AI images
 *   4. quality gate    — the site health audit runs on the result; what the AI can fix is fixed in one more pass
 */

export interface BusinessFacts {
  name: string;
  phone: string;
  email: string;
  whatsapp: string;
  address: string;
  legalName: string;
  logoUrl: string;
  tagline: string;
  facebook: string;
  instagram: string;
  products: { name: string; price: number; description: string }[];
  reviews: { author: string; rating: number; body: string }[];
  knowledge: { title: string; body: string }[];
  currency: string;
}

export const EMPTY_FACTS: BusinessFacts = { name: "", phone: "", email: "", whatsapp: "", address: "", legalName: "", logoUrl: "", tagline: "", facebook: "", instagram: "", products: [], reviews: [], knowledge: [], currency: "ILS" };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** only reviews worth showing on a website: 4-5 stars, a real sentence, deduplicated */
export function usableReviews(list: { author?: string | null; rating?: number | null; body?: string | null }[], max = 6): BusinessFacts["reviews"] {
  const seen = new Set<string>();
  const out: BusinessFacts["reviews"] = [];
  for (const r of list) {
    const body = clip(r.body, 400);
    const rating = Number(r.rating ?? 0);
    if (rating < 4 || body.length < 25) continue;
    const key = body.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ author: clip(r.author, 60) || "", rating, body });
    if (out.length >= max) break;
  }
  return out;
}

const money = (n: number, currency: string) => {
  const sym = currency === "ILS" ? "₪" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  return Number.isFinite(n) && n > 0 ? `${sym}${Number.isInteger(n) ? n : n.toFixed(2)}` : "";
};

/** the facts as a prompt section — the model must use them as written and never invent what is missing */
export function factsPrompt(f: BusinessFacts): string {
  const lines: string[] = [];
  const add = (label: string, v: string) => (v ? lines.push(`- ${label}: ${v}`) : undefined);
  add("Business name", f.name);
  add("Legal name", f.legalName);
  add("Tagline", f.tagline);
  add("Phone", f.phone);
  add("WhatsApp", f.whatsapp);
  add("Email", f.email);
  add("Address", f.address);
  add("Facebook", f.facebook);
  add("Instagram", f.instagram);
  if (f.products.length) {
    lines.push("- Products / services (real names and prices — use them for pricing / features; do not change prices):");
    for (const p of f.products.slice(0, 10)) lines.push(`  • ${p.name}${p.price > 0 ? ` — ${money(p.price, f.currency)}` : ""}${p.description ? ` — ${p.description.slice(0, 160)}` : ""}`);
  }
  if (f.reviews.length) {
    lines.push("- REAL customer reviews (use these, word for word, for the testimonials section — never write invented reviews):");
    for (const r of f.reviews.slice(0, 6)) lines.push(`  • ${"★".repeat(Math.min(5, r.rating))} ${r.author || "Customer"}: "${r.body.slice(0, 300)}"`);
  }
  if (f.knowledge.length) {
    lines.push("- What the business wrote about itself (use for about / FAQ / features):");
    for (const k of f.knowledge.slice(0, 6)) lines.push(`  • ${k.title}: ${k.body.slice(0, 280)}`);
  }
  if (!lines.length) return "";
  return [
    "BUSINESS FACTS (from the business's own account — use them exactly as written; never invent phone numbers, emails, addresses, prices, reviews or client names that are not here):",
    ...lines,
    "Write rich, specific copy around these facts: concrete benefits, clear process, objections answered in the FAQ, one strong call to action repeated at the end.",
  ].join("\n");
}

export interface ToolBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface ToolSite {
  name: string;
  blocks: ToolBlock[];
  settings?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const nonEmpty = (v: unknown) => str(v).length > 0;

/** site settings (footer, legal pages, WhatsApp button, logo) from the facts — only fields that are still empty */
export function settingsFromFacts(current: Record<string, unknown> | undefined, f: BusinessFacts, lang: "he" | "en" | "ar"): Record<string, unknown> {
  const s: Record<string, unknown> = { ...(current ?? {}) };
  const put = (k: string, v: string) => {
    if (v && !nonEmpty(s[k])) s[k] = v;
  };
  put("legal_name", f.legalName || f.name);
  put("email", f.email);
  put("phone", f.phone);
  put("address", f.address);
  put("whatsapp_button", f.whatsapp || f.phone);
  put("logo_url", /^https:\/\//.test(f.logoUrl) ? f.logoUrl : "");
  put("tagline", f.tagline);
  put("facebook", /^https:\/\//.test(f.facebook) ? f.facebook : "");
  put("instagram", /^https:\/\//.test(f.instagram) ? f.instagram : "");
  if (!s.lang) s.lang = lang;
  return s;
}

/**
 * Puts the real facts into the built blocks:
 *  - contact block: empty phone / email / WhatsApp / address are filled (a contact block is added when missing and facts exist)
 *  - testimonials: when real reviews exist they REPLACE whatever the model wrote (models invent reviews)
 * Returns what it changed (for the report on screen).
 */
export function applyFacts<T extends ToolSite>(site: T, f: BusinessFacts, titles: { contact: string; testimonials: string }): { site: T; changed: string[] } {
  const changed: string[] = [];
  const blocks = site.blocks.map((b) => ({ ...b, data: { ...b.data } }));
  const hasContactFacts = Boolean(f.phone || f.email || f.whatsapp || f.address);
  let contact = blocks.find((b) => b.type === "contact");
  if (!contact && hasContactFacts) {
    contact = { type: "contact", data: { title: titles.contact, phone: "", whatsapp: "", email: "", address: "" } };
    blocks.push(contact);
    changed.push("contact_added");
  }
  if (contact) {
    const fill = (k: string, v: string) => {
      if (v && !nonEmpty(contact!.data[k])) {
        contact!.data[k] = v;
        changed.push(`contact_${k}`);
      }
    };
    fill("phone", f.phone);
    fill("whatsapp", f.whatsapp || f.phone);
    fill("email", f.email);
    fill("address", f.address);
  }
  if (f.reviews.length >= 2) {
    const items = f.reviews.slice(0, 6).map((r) => ({ name: r.author || "", role: "", quote: r.body, rating: String(Math.min(5, Math.max(1, Math.round(r.rating)))) }));
    const t = blocks.find((b) => b.type === "testimonials");
    if (t) {
      t.data.items = items;
      changed.push("testimonials_real");
    } else {
      const heroAt = blocks.findIndex((b) => b.type === "hero");
      const at = Math.min(blocks.length, Math.max(1, heroAt + 2));
      blocks.splice(at, 0, { type: "testimonials", data: { title: titles.testimonials, items } });
      changed.push("testimonials_added");
    }
  }
  // the contact block belongs near the end, before nothing but the closing call to action
  return { site: { ...site, blocks }, changed };
}

export type ImageSlot = { kind: "hero" | "about" | "gallery"; index: number; query: string };

const STOP = new Set(["a", "an", "the", "of", "and", "with", "in", "on", "for", "to", "at", "by", "photo", "image", "picture", "professional", "high", "quality", "modern", "website", "hero", "no", "text", "watermark", "style", "shot"]);

/** an English stock-photo query from the model's image prompt (2-5 meaningful words) */
export function photoQuery(prompt: string, fallback = "business"): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const q = [...new Set(words)].slice(0, 5).join(" ");
  return q || fallback;
}

/** where the site still has no picture; the gallery gets up to `galleryMin` photos */
export function imageSlots(site: ToolSite, imagePrompt: string, galleryMin = 6): ImageSlot[] {
  const base = photoQuery(imagePrompt);
  const out: ImageSlot[] = [];
  site.blocks.forEach((b, i) => {
    if (b.type === "hero" && !nonEmpty(b.data.image_url)) out.push({ kind: "hero", index: i, query: base });
    if (b.type === "about" && !nonEmpty(b.data.image_url)) out.push({ kind: "about", index: i, query: `${base} team` });
    if (b.type === "gallery") {
      const have = Array.isArray(b.data.items) ? (b.data.items as unknown[]).length : 0;
      for (let k = have; k < galleryMin; k++) out.push({ kind: "gallery", index: i, query: base });
    }
  });
  return out.slice(0, 9);
}

/** puts found photos into their slots (gallery photos are appended as items) */
export function placeImages<T extends ToolSite>(site: T, found: { slot: ImageSlot; url: string }[]): T {
  const blocks: ToolBlock[] = site.blocks.map((b) => ({ ...b, data: { ...b.data, ...(Array.isArray(b.data.items) ? { items: [...(b.data.items as unknown[])] } : {}) } as Record<string, unknown> }));
  for (const { slot, url } of found) {
    const b = blocks[slot.index];
    if (!b || !/^https:\/\//.test(url)) continue;
    if (slot.kind === "gallery") {
      const items = (Array.isArray(b.data.items) ? b.data.items : []) as { url: string; caption: string }[];
      if (items.length < 24 && !items.some((x) => x.url === url)) items.push({ url, caption: "" });
      b.data.items = items;
    } else if (!nonEmpty(b.data.image_url)) b.data.image_url = url;
  }
  return { ...site, blocks };
}

/** the agent's report for the screen / chat: which tools worked on the site */
export interface SiteToolReport {
  facts: number;
  realReviews: boolean;
  images: number;
  quality: { before: number; after: number } | null;
  refined: boolean;
}

export function factsCount(f: BusinessFacts): number {
  return [f.phone, f.email, f.whatsapp, f.address, f.legalName, f.logoUrl, f.facebook, f.instagram].filter(Boolean).length + f.products.length + f.reviews.length + f.knowledge.length;
}
