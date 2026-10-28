/**
 * Wave 31 — site health audit. Pure and free (no AI call): looks at the site the way a
 * conversion / SEO consultant would and returns a score plus concrete, ordered fixes.
 * Every AI-fixable check carries a ready instruction for the existing "edit with the agent" engine.
 */
export type AuditTab = "content" | "design" | "business";
export type QuickKind = "hero_image" | "lead" | "contact" | "brand" | "legal";
export interface AuditBlock {
  type: string;
  data: Record<string, unknown>;
}
export interface AuditSite {
  name: string;
  status: string;
  seo: { title: string; description: string };
  blocks: AuditBlock[];
  settings?: Record<string, unknown>;
  theme?: { template?: string };
}
export interface AuditCheck {
  id: string;
  ok: boolean;
  weight: number;
  /** "ai": the agent can fix it from an instruction; "manual": the owner has to provide something (a form, a logo…) */
  fix: "ai" | "manual";
  instruction?: string;
  tab?: AuditTab;
  /** wave 37: the manual fix can be done right inside the health panel (see QuickFix) */
  quick?: QuickKind;
}
export interface AuditResult {
  score: number;
  checks: AuditCheck[];
  failing: AuditCheck[];
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const items = (b: AuditBlock | undefined): Record<string, unknown>[] => (b && Array.isArray(b.data.items) ? (b.data.items as Record<string, unknown>[]) : []);
const filled = (arr: Record<string, unknown>[], key: string) => arr.filter((i) => s(i[key]).length > 1).length;

export function auditSite(site: AuditSite): AuditResult {
  const by = (t: string) => site.blocks.filter((b) => b.type === t);
  const hero = by("hero")[0];
  const st = site.settings ?? {};
  const titleLen = site.seo.title.trim().length;
  const descLen = site.seo.description.trim().length;
  const leadBlocks = [...by("form").filter((b) => s(b.data.form_slug)), ...by("booking").filter((b) => s(b.data.booking_slug))];
  const proof = filled(items(by("testimonials")[0]), "quote") >= 2 || filled(items(by("stats")[0]), "value") >= 2 || filled(items(by("logos")[0]), "name") >= 3;
  const hasContact = by("contact").some((b) => s(b.data.phone) || s(b.data.whatsapp) || s(b.data.email)) || Boolean(s(st.phone) || s(st.whatsapp_button) || s(st.email));
  const untitled = site.blocks.filter((b) => !["hero", "cta"].includes(b.type) && !s(b.data.title)).length;
  const c = (id: string, ok: boolean, weight: number, fix: "ai" | "manual", extra: { instruction?: string; tab?: AuditTab; quick?: QuickKind } = {}): AuditCheck => ({ id, ok, weight, fix, ...extra });
  const checks: AuditCheck[] = [
    c("seo_title", titleLen >= 30 && titleLen <= 70, 10, "ai", { instruction: "Rewrite the SEO title to 40-60 characters: main keyword + business type + a benefit. Do not change anything else." }),
    c("seo_description", descLen >= 70 && descLen <= 160, 10, "ai", { instruction: "Rewrite the SEO description to 120-155 characters: what the business does, for whom, and a clear call to action. Do not change anything else." }),
    c("hero_cta", Boolean(hero && s(hero.data.cta_label) && s(hero.data.cta_href)), 12, "ai", { instruction: "Give the hero a clear action button: a short action label and a link that scrolls to the contact form or booking section (use an existing #anchor or the booking/form section)." }),
    c("hero_image", Boolean(hero && s(hero.data.image_url)), 6, "manual", { tab: "content", quick: "hero_image" }),
    c("lead_capture", leadBlocks.length > 0, 14, "manual", { tab: "content", quick: "lead" }),
    c("contact", hasContact, 8, "manual", { tab: "business", quick: "contact" }),
    c("social_proof", proof, 12, "ai", { instruction: "Add a social-proof section (testimonials, or a numbers/stats section) right after the hero. Use only facts found in the content; never invent clients, reviews or numbers - leave placeholders to fill in." }),
    c("faq", filled(items(by("faq")[0]), "q") >= 3, 8, "ai", { instruction: "Add or complete a FAQ section with 4-5 realistic questions customers ask this kind of business (pricing, process, timing, guarantees). Do not invent specific prices." }),
    c("structure", site.blocks.length >= 5, 6, "ai", { instruction: "The page is too thin. Add the missing sections a strong landing page has (benefits, how it works, FAQ, a closing call to action) without changing existing sections." }),
    c("section_titles", untitled === 0, 4, "ai", { instruction: "Give every section that has no title a short, clear title. Do not change existing titles." }),
    c("brand", Boolean(s(st.logo_url) || s(st.tagline)), 5, "manual", { tab: "business", quick: "brand" }),
    c("legal", Boolean(s(st.legal_name) && (s(st.email) || s(st.phone))), 5, "manual", { tab: "business", quick: "legal" }),
  ];
  const total = checks.reduce((a, x) => a + x.weight, 0);
  const got = checks.filter((x) => x.ok).reduce((a, x) => a + x.weight, 0);
  const failing = checks.filter((x) => !x.ok).sort((a, b) => b.weight - a.weight);
  return { score: Math.round((got / total) * 100), checks, failing };
}

/** One combined instruction for "fix everything the agent can" (a single AI call instead of many). */
export function combinedInstruction(result: AuditResult): string {
  const parts = result.failing.filter((x) => x.fix === "ai" && x.instruction).map((x, i) => `${i + 1}. ${x.instruction}`);
  return parts.length ? `Apply ALL of these improvements together and keep everything else unchanged:\n${parts.join("\n")}` : "";
}
