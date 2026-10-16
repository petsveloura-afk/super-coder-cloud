import { SITE_BLOCK_TYPES, siteBlockSchema, siteSchema, type SiteBlock } from "@scc/shared/engagement";

/**
 * Turning a model's JSON into a site the builder accepts — pure and unit-tested.
 * The model is asked for a strict shape, but every field is coerced, trimmed and
 * validated here (links must be https / relative / mailto / tel, colors #RRGGBB …),
 * so a sloppy answer can never produce an invalid or unsafe site.
 */
export type SiteMode = "landing" | "full";

export const SITE_LIMITS: Record<SiteMode, { min: number; max: number }> = {
  landing: { min: 4, max: 7 },
  full: { min: 7, max: 16 },
};

export interface SiteContext {
  formSlug?: string | null;
  bookingSlug?: string | null;
}

export function siteJsonInstructions(mode: SiteMode, locale: "he" | "ar" | "en", ctx: SiteContext): string {
  const lang = locale === "he" ? "Hebrew" : locale === "ar" ? "Arabic" : "English";
  const { min, max } = SITE_LIMITS[mode];
  return [
    `You design high-converting, professional ${mode === "full" ? "multi-section business websites" : "landing pages"}.`,
    `Write ALL visible text in ${lang}: concrete, benefit-driven, specific to the business — never lorem ipsum, never placeholders like "[name]".`,
    "Return ONLY one JSON object, no markdown, with exactly this shape:",
    `{"name": string (site name), "accent": "#RRGGBB" (brand color that fits the business), "mode": "dark"|"light",`,
    ` "seo": {"title": string ≤60 chars, "description": string ≤155 chars},`,
    ` "image_prompt": string (English, a photographic hero image description, no text in the image),`,
    ` "blocks": [ ${min}-${max} blocks ] }`,
    "Block shapes (use only these types):",
    `{"type":"hero","data":{"title","subtitle","cta_label","cta_href":"#contact"}}`,
    `{"type":"features","data":{"title","items":[{"title","text"}] (3-6 items)}}`,
    `{"type":"text","data":{"title","body"}}`,
    `{"type":"cta","data":{"title","text","label","href":"#contact"}}`,
    `{"type":"faq","data":{"title","items":[{"q","a"}] (4-8 items)}}`,
    `{"type":"contact","data":{"title","phone","whatsapp","email","address"}} (only details the customer gave; else empty strings)`,
    ctx.formSlug ? `{"type":"form","data":{"title","form_slug":"${ctx.formSlug}"}} (lead form — include it once, near the end)` : "",
    ctx.bookingSlug ? `{"type":"booking","data":{"title","text","label","booking_slug":"${ctx.bookingSlug}"}} (online booking — include it once)` : "",
    "Structure: start with hero; then value/features; social proof as text; FAQ; a strong CTA; contact last.",
    mode === "full" ? "For a full site cover: about, services (one features block per service group), process, why-us, testimonials (as text), FAQ, CTA, contact." : "",
    "Links: only https://…, #anchors, mailto: or tel:. Never invent phone numbers, emails, prices or addresses.",
  ]
    .filter(Boolean)
    .join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim().slice(0, max) : "");
const safeHref = (v: unknown) => {
  const s = str(v, 2000);
  return /^(https:\/\/\S+|\/\S*|#\S*|mailto:\S+|tel:\S+)$/.test(s) ? s : "";
};

/** Extract the first JSON object from a model answer (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

function coerceBlock(raw: unknown, ctx: SiteContext): SiteBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as { type?: unknown; data?: Record<string, unknown> };
  const type = String(b.type ?? "");
  if (!(SITE_BLOCK_TYPES as readonly string[]).includes(type)) return null;
  const d = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const items = (v: unknown) => (Array.isArray(v) ? v : []);
  let data: Record<string, unknown>;
  switch (type) {
    case "hero":
      data = { title: str(d.title, 160), subtitle: str(d.subtitle, 500), cta_label: str(d.cta_label, 60), cta_href: safeHref(d.cta_href) || "#contact", image_url: safeHref(d.image_url) };
      break;
    case "features":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 12).map((i) => ({ title: str((i as Record<string, unknown>)?.title, 120), text: str((i as Record<string, unknown>)?.text, 500) })).filter((i) => i.title || i.text) };
      break;
    case "text":
      data = { title: str(d.title, 160), body: str(d.body, 10000) };
      break;
    case "cta":
      data = { title: str(d.title, 160), text: str(d.text, 500), label: str(d.label, 60), href: safeHref(d.href) || "#contact" };
      break;
    case "faq":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 30).map((i) => ({ q: str((i as Record<string, unknown>)?.q, 300), a: str((i as Record<string, unknown>)?.a, 2000) })).filter((i) => i.q) };
      break;
    case "contact":
      data = { title: str(d.title, 160), phone: str(d.phone, 40), whatsapp: str(d.whatsapp, 40), email: str(d.email, 254), address: str(d.address, 300) };
      break;
    case "form":
      if (!ctx.formSlug) return null; // never point at a form that does not exist
      data = { title: str(d.title, 160), form_slug: ctx.formSlug };
      break;
    case "booking":
      if (!ctx.bookingSlug) return null;
      data = { title: str(d.title, 160), text: str(d.text, 500), label: str(d.label, 60), booking_slug: ctx.bookingSlug };
      break;
    default:
      return null;
  }
  const parsed = siteBlockSchema.safeParse({ type, data });
  return parsed.success ? parsed.data : null;
}

export interface NormalizedSite {
  name: string;
  theme: { accent: string; mode: "dark" | "light" };
  seo: { title: string; description: string };
  blocks: SiteBlock[];
  imagePrompt: string;
}

/** Coerce + validate a model's site JSON; null when nothing usable came back. */
export function normalizeAiSite(raw: unknown, mode: SiteMode, ctx: SiteContext, fallbackName: string): NormalizedSite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seo = (r.seo && typeof r.seo === "object" ? r.seo : {}) as Record<string, unknown>;
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(r.accent ?? "")) ? String(r.accent) : "#3366E6";
  let blocks = (Array.isArray(r.blocks) ? r.blocks : []).map((b) => coerceBlock(b, ctx)).filter((b): b is SiteBlock => b !== null);
  // a hero first, contact last — whatever order the model chose
  const hero = blocks.find((b) => b.type === "hero");
  const contact = blocks.filter((b) => b.type === "contact").slice(-1);
  blocks = [...(hero ? [hero] : []), ...blocks.filter((b) => b !== hero && b.type !== "contact"), ...contact].slice(0, SITE_LIMITS[mode].max);
  if (!blocks.some((b) => b.type === "hero") || blocks.length < 2) return null;
  const name = str(r.name, 120) || fallbackName.slice(0, 120) || "Site";
  const site = {
    name,
    theme: { accent, mode: r.mode === "light" ? ("light" as const) : ("dark" as const) },
    seo: { title: str(seo.title, 70) || name.slice(0, 70), description: str(seo.description, 160) },
    blocks,
    imagePrompt: str(r.image_prompt, 600),
  };
  // final guard: the same schema the builder saves with (slug/status are set by the caller)
  const check = siteSchema.safeParse({ name: site.name, slug: "ai-site-check", status: "draft", theme: site.theme, seo: site.seo, blocks: site.blocks });
  return check.success ? site : null;
}

/** ASCII slug from a (possibly Hebrew/Arabic) name, always unique-ish and schema-valid. */
export function siteSlug(name: string, rand: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base.length >= 3 ? base : "site"}-${rand.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "x1y2z3"}`;
}
