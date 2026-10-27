import { describe, expect, it } from "vitest";
import { siteBlockSchema } from "@scc/shared/engagement";
import { parseBuildDirectives, polishBuiltSite, siteBuildOverrides, type PolishableSite } from "@/lib/ai/site-build-rules";

const base = (blocks: PolishableSite["blocks"], extra: Partial<PolishableSite> = {}): PolishableSite => ({
  name: "Demo",
  theme: { accent: "#3366E6", mode: "light", template: "classic" },
  seo: { title: "A".repeat(80), description: "B".repeat(200) },
  blocks,
  ...extra,
});
const hero = { type: "hero", data: { title: "Hi", subtitle: "s", cta_label: "", cta_href: "#contact", image_url: "" } } as never;
const faq = { type: "faq", data: { title: "Q", items: [{ q: "q", a: "a" }] } } as never;
const cta = { type: "cta", data: { title: "go", text: "t", label: "l", href: "#contact" } } as never;
const features = { type: "features", data: { title: "f", items: [{ title: "a", text: "b" }] } } as never;
const contact = { type: "contact", data: { title: "c", phone: "", whatsapp: "", email: "", address: "" } } as never;
const opts = { locale: "en" as const, templates: ["classic", "minimal", "fresh", "luxe", "noir"], maxBlocks: 8 };

describe("wave 36 - reading the owner's instructions", () => {
  it("understands the structured Preferences block", () => {
    const d = parseBuildDirectives("About my shop\n\nPreferences:\nStyle: luxury\nMust include: gallery, pricing\nMust not include: faq\nMode: dark\nAnimations: yes");
    expect(d).toMatchObject({ style: "luxury", mode: "dark", animations: true });
    expect(d.include).toEqual(["gallery", "pricing"]);
    expect(d.exclude).toEqual(["faq"]);
  });
  it("understands free Hebrew and English", () => {
    const he = parseBuildDirectives("אני רוצה אתר מונפש בצבעי כחול וזהב עם גלריה ובלי מחירים, עיצוב כהה, יוקרתי");
    expect(he.animations).toBe(true);
    expect(he.accent).toBe("#2563EB");
    expect(he.accent2).toBe("#C9A24D");
    expect(he.include).toContain("gallery");
    expect(he.exclude).toContain("pricing");
    expect(he.mode).toBe("dark");
    expect(he.style).toBe("luxury");
    const en = parseBuildDirectives("Dental clinic in Haifa. Add testimonials and a team section, no animations, light theme.");
    expect(en.include).toEqual(expect.arrayContaining(["testimonials", "team"]));
    expect(en.animations).toBe(false);
    expect(en.mode).toBe("light");
    expect(en.industry).toBe("clinic");
  });
  it("a section that is both asked for and refused is not added", () => {
    const d = parseBuildDirectives("Must include: pricing\nMust not include: pricing");
    expect(d.include).not.toContain("pricing");
  });
  it("the prompt carries the owner's demands and the business recipe", () => {
    const p = siteBuildOverrides(parseBuildDirectives("Law firm. Must include: testimonials\nStyle: corporate"), "landing");
    expect(p).toContain("testimonials");
    expect(p).toContain("Law / professional");
    expect(p).toContain("corporate");
    expect(p).toContain("NEVER invent");
  });
});

describe("wave 36 - the site always follows the instructions", () => {
  it("adds a requested section the model forgot (labelled placeholder) and removes a refused one", () => {
    const d = parseBuildDirectives("Must include: testimonials, team\nMust not include: faq");
    const { site, applied } = polishBuiltSite(base([hero, features, faq, cta, contact]), d, opts);
    const types = site.blocks.map((b) => b.type);
    expect(types).toEqual(expect.arrayContaining(["testimonials", "team"]));
    expect(types).not.toContain("faq");
    expect(applied).toEqual(expect.arrayContaining(["exclude", "add:testimonials", "add:team"]));
    for (const b of site.blocks) expect(siteBlockSchema.safeParse(b).success, b.type).toBe(true);
  });
  it("every placeholder section is valid for the builder, in every language", () => {
    for (const locale of ["he", "ar", "en"] as const) {
      const d = parseBuildDirectives("Must include: testimonials, pricing, stats, team, faq, steps, about, logos, gallery");
      const { site } = polishBuiltSite(base([hero, contact]), d, { ...opts, locale, maxBlocks: 16 });
      expect(site.blocks.length).toBeGreaterThanOrEqual(10);
      for (const b of site.blocks) expect(siteBlockSchema.safeParse(b).success, `${locale}:${b.type}`).toBe(true);
    }
  });
  it("orders hero first and faq, cta, contact last", () => {
    const { site } = polishBuiltSite(base([features, contact, cta, hero, faq]), parseBuildDirectives(""), opts);
    expect(site.blocks.map((b) => b.type)).toEqual(["hero", "features", "faq", "cta", "contact"]);
  });
  it("buttons never point at a missing section", () => {
    const h = { type: "hero", data: { title: "Hi", subtitle: "", cta_label: "", cta_href: "#contact", image_url: "" } } as never;
    const form = { type: "form", data: { title: "f", form_slug: "lead" } } as never;
    const { site } = polishBuiltSite(base([h, features, form]), parseBuildDirectives(""), opts);
    const hh = site.blocks[0] as unknown as { data: { cta_href: string; cta_label: string } };
    expect(hh.data.cta_href).toBe("#form");
    expect(hh.data.cta_label.length).toBeGreaterThan(2);
  });
  it("applies mode, colours, animations and a style template the plan allows", () => {
    const d = parseBuildDirectives("Style: luxury\nMode: dark\nAnimations: no");
    const { site } = polishBuiltSite(base([hero, features, contact]), { ...d, accent: "#C9A24D" }, opts);
    expect(site.theme).toMatchObject({ mode: "dark", animations: false, template: "luxe", accent: "#C9A24D", radius: "sharp" });
    const locked = polishBuiltSite(base([hero, features, contact]), d, { ...opts, templates: ["classic", "minimal"] });
    expect(locked.site.theme.template).toBe("classic"); // no luxury template allowed on this plan -> the model's choice stays
    const minimal = polishBuiltSite(base([hero, features, contact]), parseBuildDirectives("Style: minimal"), { ...opts, templates: ["classic", "minimal"] });
    expect(minimal.site.theme.template).toBe("minimal");
    const picked = polishBuiltSite(base([hero, features, contact]), d, { ...opts, template: "classic" });
    expect(picked.site.theme.template).toBe("classic");
  });
  it("animations stay on by default and the search texts fit", () => {
    const { site } = polishBuiltSite(base([hero, features, contact]), parseBuildDirectives(""), opts);
    expect(site.theme.animations).toBe(true);
    expect(site.seo.title.length).toBeLessThanOrEqual(60);
    expect(site.seo.description.length).toBeLessThanOrEqual(155);
  });
});

describe("wave 36 - builder screen texts", async () => {
  const { SECTION_KEYS, STYLE_KEYS } = await import("@/lib/ai/site-build-rules");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const l of ["he", "ar", "en"]) {
    it(`${l}: every style, section and label exists`, () => {
      const w = JSON.parse(readFileSync(join(process.cwd(), `lib/i18n/dictionaries/${l}.json`), "utf8")).websites.aiPrefs;
      for (const k of STYLE_KEYS) expect(w.styles[k], k).toBeTruthy();
      for (const k of SECTION_KEYS) expect(w.secs[k], k).toBeTruthy();
      for (const k of ["title", "style", "sections", "modeAuto", "animated"]) expect(w[k], k).toBeTruthy();
    });
  }
  it("the editor's save bar sits above the mobile bottom navigation", () => {
    const s = readFileSync(join(process.cwd(), "components/websites/site-builder.tsx"), "utf8");
    expect(s).toContain("max-lg:bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px)+0.5rem)]");
  });
  it("the build wires directives, overrides and polish", () => {
    const s = readFileSync(join(process.cwd(), "lib/ai/site-builder.ts"), "utf8");
    expect(s).toContain("parseBuildDirectives(ownerText)");
    expect(s).toContain("siteBuildOverrides(directives, mode)");
    expect(s).toContain("polishBuiltSite(site, directives");
  });
});
