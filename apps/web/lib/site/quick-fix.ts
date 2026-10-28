/**
 * Wave 37 — fixes the owner types into the health panel (pure, unit-tested).
 * Nothing here calls AI: it takes the site and the few values the owner typed and returns the new
 * site (or a precise error). Existing content is never overwritten with an empty value.
 */
import type { QuickKind } from "./audit-core";

export type QuickValues = Record<string, string>;
interface Blk {
  type: string;
  data: Record<string, unknown>;
}
interface QSite {
  blocks: Blk[];
  settings?: Record<string, unknown>;
  [k: string]: unknown;
}
export type QuickResult<T extends QSite> = { ok: true; site: T } | { ok: false; error: "invalid_phone" | "invalid_email" | "invalid_url" | "empty" | "no_hero" | "no_choice" };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const phoneOk = (s: string) => /^[+\d][\d\s\-().]{5,38}$/.test(s) && s.replace(/\D/g, "").length >= 7;
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const httpsOk = (s: string) => /^https:\/\/\S+$/.test(s);

/** are the typed values enough to enable the apply button? */
export function quickFixReady(kind: QuickKind, v: QuickValues, ctx: { hasContactInfo?: boolean } = {}): boolean {
  const f = (k: string) => clean(v[k], 400);
  switch (kind) {
    case "contact":
      return Boolean(f("phone") || f("email"));
    case "brand":
      return Boolean(f("tagline") || f("logo_url"));
    case "legal":
      return Boolean(f("legal_name")) && (ctx.hasContactInfo || Boolean(f("phone")));
    case "hero_image":
      return Boolean(f("image_url"));
    case "lead":
      return Boolean(f("lead"));
  }
}

export function applyQuickFix<T extends QSite>(site: T, kind: QuickKind, v: QuickValues, ctx: { forms: { slug: string }[]; bookings: { slug: string }[] }): QuickResult<T> {
  const f = (k: string, max = 400) => clean(v[k], max);
  const settings = { ...(site.settings ?? {}) };
  const withSettings = (patch: Record<string, string>) => ({ ...site, settings: { ...settings, ...patch } }) as T;
  switch (kind) {
    case "contact": {
      const phone = f("phone", 40);
      const email = f("email", 254);
      if (!phone && !email) return { ok: false, error: "empty" };
      if (phone && !phoneOk(phone)) return { ok: false, error: "invalid_phone" };
      if (email && !emailOk(email)) return { ok: false, error: "invalid_email" };
      return { ok: true, site: withSettings({ ...(phone ? { phone } : {}), ...(email ? { email } : {}) }) };
    }
    case "brand": {
      const tagline = f("tagline", 300);
      const logo = f("logo_url", 2000);
      if (!tagline && !logo) return { ok: false, error: "empty" };
      if (logo && !httpsOk(logo)) return { ok: false, error: "invalid_url" };
      return { ok: true, site: withSettings({ ...(tagline ? { tagline } : {}), ...(logo ? { logo_url: logo } : {}) }) };
    }
    case "legal": {
      const legal = f("legal_name", 160);
      const phone = f("phone", 40);
      if (!legal) return { ok: false, error: "empty" };
      if (phone && !phoneOk(phone)) return { ok: false, error: "invalid_phone" };
      return { ok: true, site: withSettings({ legal_name: legal, ...(phone ? { phone } : {}) }) };
    }
    case "hero_image": {
      const url = f("image_url", 2000);
      if (!url) return { ok: false, error: "empty" };
      if (!httpsOk(url)) return { ok: false, error: "invalid_url" };
      const i = site.blocks.findIndex((b) => b.type === "hero");
      if (i < 0) return { ok: false, error: "no_hero" };
      const blocks = site.blocks.map((b, k) => (k === i ? { ...b, data: { ...b.data, image_url: url } } : b));
      return { ok: true, site: { ...site, blocks } };
    }
    case "lead": {
      const [type, slug] = f("lead", 80).split(":");
      const known = type === "form" ? ctx.forms.some((x) => x.slug === slug) : type === "booking" ? ctx.bookings.some((x) => x.slug === slug) : false;
      if (!slug || !known) return { ok: false, error: "no_choice" };
      const block: Blk = type === "form" ? { type: "form", data: { title: "", form_slug: slug } } : { type: "booking", data: { title: "", text: "", label: "", booking_slug: slug } };
      // right before the closing call to action / contact, otherwise at the end — never between hero and content
      let at = site.blocks.length;
      for (let k = site.blocks.length - 1; k >= 1; k--) {
        if (["contact", "cta"].includes(site.blocks[k]!.type)) at = k;
        else if (at !== site.blocks.length) break;
      }
      const blocks = [...site.blocks.slice(0, at), block, ...site.blocks.slice(at)];
      return { ok: true, site: { ...site, blocks } };
    }
  }
}
