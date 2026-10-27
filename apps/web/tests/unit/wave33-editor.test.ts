import { describe, expect, it } from "vitest";
import { diffSites, stableStringify, type DiffSite } from "@/lib/site/diff";
import { blockTexts, detectSiteLanguage, siteEditOverrides } from "@/lib/ai/site-edit-rules";

const site = (blocks: DiffSite["blocks"], extra: Partial<DiffSite> = {}): DiffSite => ({ name: "A", theme: { accent: "#111111", mode: "dark" }, seo: { title: "t", description: "d" }, blocks, ...extra });
const hero = { type: "hero", data: { title: "Hi", subtitle: "", cta_label: "", cta_href: "#contact", image_url: "" } };
const faq = { type: "faq", data: { title: "FAQ", items: [{ q: "q", a: "a" }] } };
const contact = { type: "contact", data: { title: "Contact", phone: "", whatsapp: "", email: "", address: "" } };

describe("wave 33 — site diff (what did the agent change?)", () => {
  it("is empty when nothing changed, whatever the key order", () => {
    const a = site([hero, faq]);
    const b = site([{ type: "hero", data: { image_url: "", cta_href: "#contact", cta_label: "", subtitle: "", title: "Hi" } }, faq]);
    expect(diffSites(a, b).empty).toBe(true);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it("reports added sections with their index in the new list", () => {
    const pricing = { type: "pricing", data: { title: "Prices", items: [{ name: "Basic" }] } };
    const d = diffSites(site([hero, faq, contact]), site([hero, pricing, faq, contact]));
    expect(d.added).toBe(1);
    expect(d.changed).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.touched).toEqual([1]);
    expect(d.blocks[0]).toEqual({ index: 1, type: "pricing", kind: "added" });
  });

  it("reports an edited section as changed and a dropped one as removed", () => {
    const hero2 = { type: "hero", data: { ...hero.data, title: "A better headline" } };
    const d = diffSites(site([hero, faq, contact]), site([hero2, contact]));
    expect(d.changed).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.touched).toEqual([0]);
    expect(d.blocks.find((c) => c.kind === "removed")?.type).toBe("faq");
  });

  it("notices design, SEO and name changes even when sections are untouched", () => {
    const d = diffSites(site([hero]), site([hero], { name: "B", theme: { accent: "#222222", mode: "dark", template: "luxe" }, seo: { title: "new", description: "d" } }));
    expect(d.empty).toBe(false);
    expect(d.theme.sort()).toEqual(["accent", "template"]);
    expect(d.seo).toBe(true);
    expect(d.name).toBe(true);
    expect(d.touched).toEqual([]);
  });

  it("counts a pure re-order as a change", () => {
    expect(diffSites(site([hero, faq]), site([faq, hero])).empty).toBe(false);
  });
});

describe("wave 33 — rules for editing with the agent", () => {
  it("detects the language the site is written in", () => {
    expect(detectSiteLanguage(["ברוכים הבאים לאתר שלנו", "אנחנו עושים הכול"])).toBe("he");
    expect(detectSiteLanguage(["Welcome to our brand new website"])).toBe("en");
    expect(detectSiteLanguage(["مرحبا بكم في موقعنا الجديد"])).toBe("ar");
    expect(detectSiteLanguage(["Hi"])).toBeNull();
  });

  it("collects visible texts but not links", () => {
    expect(blockTexts([{ data: { title: "T", cta_href: "#contact", image_url: "https://x.co/a.png", items: [{ q: "Q" }] } }])).toEqual(["T", "Q"]);
  });

  it("keeps the site language, every section type and requires adding requested sections", () => {
    const r = siteEditOverrides("en");
    expect(r).toContain("English");
    expect(r).toContain('"type":"gallery"');
    expect(r).toContain('"type":"video"');
    expect(r).toContain('"type":"team"');
    expect(r).toMatch(/MUST add it/);
    expect(r).toMatch(/NEVER invent/);
    expect(r).toMatch(/OVERRIDE/);
    expect(siteEditOverrides(null)).not.toContain("undefined");
  });
});
