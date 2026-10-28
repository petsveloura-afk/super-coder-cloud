import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SITE_BLOCK_TYPES, siteBlockSchema } from "@scc/shared/engagement";
import { extractJson, normalizeAiSite } from "@/lib/ai/site-json";
import { detectIndustry, siteBrain, siteGaps } from "@/lib/ai/site-brain";
import { auditSite } from "@/lib/site/audit-core";
import { applyQuickFix, quickFixReady } from "@/lib/site/quick-fix";
import { safeDraft } from "@/lib/site/live-draft";

const hero = { type: "hero", data: { title: "ברוכים הבאים", subtitle: "x", cta_label: "צור קשר", cta_href: "#contact", image_url: "" } };
type Site = { name: string; seo: { title: string; description: string }; status: string; blocks: { type: string; data: Record<string, unknown> }[]; settings?: Record<string, unknown> };
const base: Site = { name: "n", seo: { title: "", description: "" }, status: "draft", blocks: [hero, { type: "cta", data: { title: "c", text: "", label: "go", href: "#contact" } }, { type: "contact", data: { title: "k", phone: "", whatsapp: "", email: "", address: "" } }] };

describe("wave 37 — new sections", () => {
  it("are part of the schema and validate", () => {
    for (const t of ["banner", "trust", "timeline", "comparison", "countdown"]) expect(SITE_BLOCK_TYPES).toContain(t);
    expect(siteBlockSchema.safeParse({ type: "countdown", data: { title: "t", ends_at: "2026-12-31" } }).success).toBe(true);
    expect(siteBlockSchema.safeParse({ type: "countdown", data: { title: "t", ends_at: "31/12/2026" } }).success).toBe(false);
    expect(siteBlockSchema.safeParse({ type: "comparison", data: { title: "t", items: [{ feature: "f", us: "yes", them: "" }] } }).success).toBe(true);
  });
  it("are coerced from a model answer, dropping junk and invented values safely", () => {
    const raw = extractJson(
      JSON.stringify({ name: "x", blocks: [hero, { type: "banner", data: { text: "מבצע", label: "לפרטים", href: "javascript:alert(1)" } }, { type: "trust", data: { items: [{ title: "אחריות", text: "שנה" }, { title: "" }] } }, { type: "comparison", data: { items: [{ feature: "מהיר", us: true, them: false }] } }, { type: "countdown", data: { ends_at: "soon" } }, { type: "timeline", data: { items: [{ title: "שלב 1" }] } }] }),
    );
    const site = normalizeAiSite(raw, "full", {}, "x", { keepOrder: true })!;
    const by = (t: string) => site.blocks.find((b) => b.type === t) as { data: Record<string, unknown> } | undefined;
    expect(by("banner")!.data.href).toBe("#contact");
    expect((by("trust")!.data.items as unknown[]).length).toBe(1);
    expect((by("comparison")!.data.items as { us: string; them: string }[])[0]).toMatchObject({ us: "yes", them: "" });
    expect(by("countdown")!.data.ends_at).toBe("");
    expect(by("timeline")).toBeTruthy();
  });
  it("a half-filled new section never blanks the live preview", () => {
    const s = safeDraft({ blocks: [{ type: "trust", data: {} }, { type: "timeline" }, { type: "comparison", data: { title: "x" } }] });
    for (const b of s.blocks as unknown as { data: { items: unknown[] } }[]) expect(Array.isArray(b.data.items)).toBe(true);
  });
  it("renders in the published-site renderer and has styles and strings", () => {
    const tsx = fs.readFileSync(path.join(__dirname, "../../components/websites/site-pro.tsx"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../../components/websites/site-pro.css"), "utf8");
    for (const c of ["banner", "trust", "timeline", "comparison", "countdown"]) expect(tsx).toContain(`case "${c}"`);
    for (const k of [".bnr", ".trust", ".tl", ".cmp", ".cd"]) expect(css).toContain(`.scs ${k}`);
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../../lib/i18n/dictionaries/${l}.json`), "utf8"));
      for (const b of ["banner", "trust", "timeline", "comparison", "countdown"]) expect(d.websites.blocks[b], `${l}.blocks.${b}`).toBeTruthy();
      for (const k of ["cmpOthers", "cdDays", "cdHours", "cdMin", "cdSec"]) expect(d.websites.site[k], `${l}.site.${k}`).toBeTruthy();
      for (const k of ["phone", "email", "tagline", "logo", "legalName", "imageUrl", "apply", "applied"]) expect(d.websites.pro37.quick[k], `${l}.quick.${k}`).toBeTruthy();
      for (const k of ["trustBadges", "timeline", "comparison", "countdown", "banner", "polish"]) {
        expect(d.websites.aiEdit.quick[k], `${l}.chip text ${k}`).toBeTruthy();
        expect(d.websites.aiEdit.quickLabel[k], `${l}.chip label ${k}`).toBeTruthy();
      }
    }
  });
});

describe("wave 37 — health panel fixes", () => {
  it("each manual check carries an in-panel fix", () => {
    const r = auditSite(base as never);
    const q = Object.fromEntries(r.checks.filter((c) => c.fix === "manual").map((c) => [c.id, c.quick]));
    expect(q).toMatchObject({ hero_image: "hero_image", lead_capture: "lead", contact: "contact", brand: "brand", legal: "legal" });
  });
  it("contact: validates and writes to the business settings, keeping what exists", () => {
    expect(applyQuickFix(base, "contact", { phone: "abc" }, { forms: [], bookings: [] })).toMatchObject({ ok: false, error: "invalid_phone" });
    expect(applyQuickFix(base, "contact", { email: "nope" }, { forms: [], bookings: [] })).toMatchObject({ ok: false, error: "invalid_email" });
    const r = applyQuickFix({ ...base, settings: { tagline: "keep" } }, "contact", { phone: "050-123-4567", email: "a@b.co" }, { forms: [], bookings: [] });
    expect(r.ok && r.site.settings).toMatchObject({ phone: "050-123-4567", email: "a@b.co", tagline: "keep" });
    expect(auditSite((r as { site: Site }).site as never).checks.find((c) => c.id === "contact")!.ok).toBe(true);
  });
  it("hero image: https only, written to the hero", () => {
    expect(applyQuickFix(base, "hero_image", { image_url: "http://x" }, { forms: [], bookings: [] })).toMatchObject({ ok: false, error: "invalid_url" });
    const r = applyQuickFix(base, "hero_image", { image_url: "https://img.example/a.jpg" }, { forms: [], bookings: [] });
    expect(r.ok && (r.site.blocks[0]!.data as { image_url: string }).image_url).toBe("https://img.example/a.jpg");
  });
  it("lead: adds a form block before the closing call to action, only for a real form", () => {
    expect(applyQuickFix(base, "lead", { lead: "form:ghost" }, { forms: [{ slug: "real" }], bookings: [] })).toMatchObject({ ok: false, error: "no_choice" });
    const r = applyQuickFix(base, "lead", { lead: "form:real" }, { forms: [{ slug: "real" }], bookings: [] });
    expect(r.ok && r.site.blocks.map((b) => b.type)).toEqual(["hero", "form", "cta", "contact"]);
    expect(auditSite((r as { site: Site }).site as never).checks.find((c) => c.id === "lead_capture")!.ok).toBe(true);
  });
  it("legal + brand + ready-state", () => {
    expect(quickFixReady("legal", { legal_name: "x" }, { hasContactInfo: false })).toBe(false);
    expect(quickFixReady("legal", { legal_name: "x" }, { hasContactInfo: true })).toBe(true);
    const r = applyQuickFix(base, "brand", { tagline: "הכי טוב" }, { forms: [], bookings: [] });
    expect(r.ok && r.site.settings).toMatchObject({ tagline: "הכי טוב" });
  });
});

describe("wave 37 — agent knowledge", () => {
  it("recognises the business type from its own texts", () => {
    expect(detectIndustry(["מרפאת שיניים בתל אביב", "טיפול שורש"])).toBe("clinic");
    expect(detectIndustry(["Italian restaurant and catering"])).toBe("restaurant");
    expect(detectIndustry(["משרד עורכי דין"])).toBe("law");
    expect(detectIndustry(["xyz"])).toBeNull();
  });
  it("names what the site lacks and stays advisory", () => {
    expect(siteGaps([{ type: "hero" }])).toEqual(expect.arrayContaining(["no FAQ", "a thin page (fewer than 5 sections)"]));
    const brain = siteBrain(["Dental clinic"], [{ type: "hero" }]);
    expect(brain).toContain("advisory");
    expect(brain).toContain("INDUSTRY PLAYBOOK");
    expect(brain).toContain("never invent");
  });
});
