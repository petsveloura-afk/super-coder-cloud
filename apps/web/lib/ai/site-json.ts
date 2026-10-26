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
    // wave 13 — richer sections
    case "about":
      data = { title: str(d.title, 160), body: str(d.body, 5000), image_url: safeHref(d.image_url) };
      break;
    case "gallery":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 24).map((i) => ({ url: safeHref((i as Record<string, unknown>)?.url), caption: str((i as Record<string, unknown>)?.caption, 200) })).filter((i) => i.url) };
      break;
    case "testimonials":
      data = {
        title: str(d.title, 160),
        items: items(d.items)
          .slice(0, 12)
          .map((i) => {
            const r = i as Record<string, unknown>;
            const rating = String(r?.rating ?? "5").replace(/[^1-5]/g, "").slice(0, 1) || "5";
            return { name: str(r?.name, 80), role: str(r?.role, 80), quote: str(r?.quote, 600), rating };
          })
          .filter((i) => i.quote),
      };
      break;
    case "stats":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 8).map((i) => ({ value: str((i as Record<string, unknown>)?.value, 20), label: str((i as Record<string, unknown>)?.label, 80) })).filter((i) => i.value || i.label) };
      break;
    case "pricing":
      data = {
        title: str(d.title, 160),
        items: items(d.items)
          .slice(0, 6)
          .map((i) => {
            const r = i as Record<string, unknown>;
            const features = Array.isArray(r?.features) ? (r.features as unknown[]).map((x) => str(x, 200)).filter(Boolean).join("\n") : str(r?.features, 1200);
            return { name: str(r?.name, 80), price: str(r?.price, 30), period: str(r?.period, 30), features: features.slice(0, 1200), highlight: r?.highlight === true || r?.highlight === "yes" ? "yes" : "", cta_label: str(r?.cta_label, 40), cta_href: safeHref(r?.cta_href) || "#contact" };
          })
          .filter((i) => i.name || i.price),
      };
      break;
    case "steps":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 8).map((i) => ({ title: str((i as Record<string, unknown>)?.title, 120), text: str((i as Record<string, unknown>)?.text, 400) })).filter((i) => i.title || i.text) };
      break;
    case "team":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 16).map((i) => ({ name: str((i as Record<string, unknown>)?.name, 80), role: str((i as Record<string, unknown>)?.role, 80), image_url: safeHref((i as Record<string, unknown>)?.image_url) })).filter((i) => i.name) };
      break;
    case "logos":
      data = { title: str(d.title, 160), items: items(d.items).slice(0, 20).map((i) => ({ name: str(typeof i === "string" ? i : (i as Record<string, unknown>)?.name, 60) })).filter((i) => i.name) };
      break;
    case "video": {
      const url = str(d.url, 500);
      data = { title: str(d.title, 160), url: /^https:\/\/(www\.)?(youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com)\/\S+$/.test(url) ? url : "", text: str(d.text, 500) };
      if (!data.url) return null;
      break;
    }
    default:
      return null;
  }
  const parsed = siteBlockSchema.safeParse({ type, data });
  return parsed.success ? parsed.data : null;
}

/** wave 13: template + second colour + font + corners chosen by the model (validated) */
const AI_TEMPLATES = ["classic", "minimal", "fresh", "aurora", "luxe", "bold", "corporate", "pastel", "neon", "nature", "editorial", "midnight", "sunset", "ocean", "clinic", "noir", "terracotta", "studio"] as const;
const AI_FONTS = ["rubik", "heebo", "assistant", "frank", "inter", "playfair", "secular", "varela", "suez", "karantina", "noto-serif"] as const;
function aiThemeExtras(r: Record<string, unknown>, allowed?: readonly string[]): { template?: (typeof AI_TEMPLATES)[number]; accent2?: string; font?: (typeof AI_FONTS)[number]; radius?: "sharp" | "soft" | "round"; animations?: boolean } {
  const out: ReturnType<typeof aiThemeExtras> = {};
  const tpl = String(r.template ?? "");
  if ((AI_TEMPLATES as readonly string[]).includes(tpl)) out.template = (allowed && !allowed.includes(tpl) ? (allowed[0] ?? "classic") : tpl) as (typeof AI_TEMPLATES)[number];
  else if (allowed) out.template = (allowed[0] ?? "classic") as (typeof AI_TEMPLATES)[number];
  if (/^#[0-9a-fA-F]{6}$/.test(String(r.accent2 ?? ""))) out.accent2 = String(r.accent2);
  if ((AI_FONTS as readonly string[]).includes(String(r.font ?? ""))) out.font = String(r.font) as (typeof AI_FONTS)[number];
  if (r.radius === "sharp" || r.radius === "soft" || r.radius === "round") out.radius = r.radius;
  if (typeof r.animations === "boolean") out.animations = r.animations;
  return out;
}

export interface NormalizedSite {
  name: string;
  theme: { accent: string; mode: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: "sharp" | "soft" | "round"; animations?: boolean };
  seo: { title: string; description: string };
  blocks: SiteBlock[];
  imagePrompt: string;
}

/** Coerce + validate a model's site JSON; null when nothing usable came back. */
export function normalizeAiSite(raw: unknown, mode: SiteMode, ctx: SiteContext, fallbackName: string, opts?: { maxBlocks?: number; templates?: readonly string[]; keepOrder?: boolean }): NormalizedSite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seo = (r.seo && typeof r.seo === "object" ? r.seo : {}) as Record<string, unknown>;
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(r.accent ?? "")) ? String(r.accent) : "#3366E6";
  let blocks = (Array.isArray(r.blocks) ? r.blocks : []).map((b) => coerceBlock(b, ctx)).filter((b): b is SiteBlock => b !== null);
  // a hero first, contact last — whatever order the model chose
  const hero = blocks.find((b) => b.type === "hero");
  const contact = blocks.filter((b) => b.type === "contact").slice(-1);
  if (!opts?.keepOrder) blocks = [...(hero ? [hero] : []), ...blocks.filter((b) => b !== hero && b.type !== "contact"), ...contact];
  blocks = blocks.slice(0, opts?.maxBlocks ?? SITE_LIMITS[mode].max);
  if (!blocks.some((b) => b.type === "hero") || blocks.length < 2) return null;
  const name = str(r.name, 120) || fallbackName.slice(0, 120) || "Site";
  const site = {
    name,
    theme: { accent, mode: r.mode === "light" ? ("light" as const) : ("dark" as const), ...aiThemeExtras(r, opts?.templates) },
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

/**
 * Wave 13 — the professional prompt: everything above plus the richer sections, a
 * design template chosen for the business, a second brand colour and copy that fits
 * the subject. `templates` = the templates the plan allows (first = fallback).
 */
export function siteJsonInstructionsPro(mode: SiteMode, locale: "he" | "ar" | "en", ctx: SiteContext, templates: readonly string[]): string {
  return [
    siteJsonInstructions(mode, locale, ctx),
    "",
    "EXTRA TOP-LEVEL FIELDS (add them to the same JSON object):",
    `"template": one of ${JSON.stringify(templates)} — the design that best fits the business (e.g. luxe for real estate / fine dining, fresh for clinics & beauty, corporate for law / accounting, bold for shops & events, aurora for tech, nature for natural products, pastel for kids & bakeries, neon for nightlife & fitness, minimal for consultants, editorial for blogs & architects, midnight for SaaS & fintech, sunset for restaurants & cafes, ocean for travel & marine, clinic for doctors & therapists, noir for photographers & fashion, terracotta for boutiques & ceramics, studio for agencies & freelancers).`,
    `"accent2": "#RRGGBB" a second brand colour that harmonises with accent; "font": one of ["rubik","heebo","assistant","frank","secular","varela","suez","noto-serif"] (Hebrew-friendly) or omit; "radius": "sharp"|"soft"|"round".`,
    "EXTRA BLOCK TYPES you may use (in addition to the ones above):",
    `{"type":"about","data":{"title","body"}} (the story, values, experience — 2-4 short paragraphs)`,
    `{"type":"stats","data":{"title","items":[{"value","label"}] (3-4 items)}} ONLY with numbers the customer gave (years, clients, projects); otherwise skip`,
    `{"type":"steps","data":{"title","items":[{"title","text"}] (3-4 items)}} (how it works / the process)`,
    `{"type":"testimonials","data":{"title","items":[{"name","role","quote","rating":"5"}]}} ONLY quotes the customer actually gave — never invent reviews; otherwise skip this block`,
    `{"type":"pricing","data":{"title","items":[{"name","price","period","features":"one per line","highlight":"yes"|"" ,"cta_label","cta_href":"#contact"}]}} ONLY with prices the customer gave`,
    `{"type":"logos","data":{"title","items":[{"name"}]}} ONLY real client / partner names the customer gave`,
    "Write copy that sounds like this specific business (its city, audience, tone), short sentences, concrete benefits. Vary section titles — no generic 'Our services' unless it fits.",
    mode === "full" ? "A full site should use about, features, steps, (stats/testimonials/pricing only with real data), faq, cta and contact." : "A landing page: hero, features or about, steps, faq, cta, contact.",
  ].join("\n");
}
