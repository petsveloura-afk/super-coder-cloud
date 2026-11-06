import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { siteSchema, siteBlockStyledSchema } from "@scc/shared/engagement";
import { STYLE_PACKS, applyStylePack, balanceRhythm, cleanSectionStyle, packFor, packTheme, sectionStyleAttrs } from "@/lib/site/section-style";
import { resolveTheme } from "@/lib/site/templates";
import { normalizeAiSite } from "@/lib/ai/site-json";
import { parseBuildDirectives, polishBuiltSite, type PolishableSite } from "@/lib/ai/site-build-rules";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const hero = { type: "hero", data: { title: "מספרה", subtitle: "", cta_label: "קבעו", cta_href: "#contact", image_url: "" } };
const features = { type: "features", data: { title: "השירותים", items: [{ title: "צבע", text: "צבע מקצועי" }] } };
const testimonials = { type: "testimonials", data: { title: "לקוחות", items: [{ name: "דנה", role: "", quote: "מושלם", rating: "5" }] } };
const faq = { type: "faq", data: { title: "שאלות", items: [{ q: "מה?", a: "כך." }] } };
const contact = { type: "contact", data: { title: "צרו קשר", phone: "050-1234567", whatsapp: "", email: "", address: "" } };
type TB = { type: string; data: Record<string, unknown>; style?: Record<string, unknown> };
const site = (blocks: TB[], theme: Record<string, unknown> = { accent: "#3366E6", mode: "dark" }) => ({ name: "מספרת שירן", slug: "shiran-salon", status: "draft", theme, seo: { title: "", description: "" }, blocks });

describe("section design — a page builder's section inspector", () => {
  it("the site schema keeps a section's design; unknown values are dropped, never fail the whole site", () => {
    const ok = siteSchema.safeParse(site([{ ...hero, style: { anim: "zoom", bg: "bogus", pad: "roomy", junk: 1 } }, contact]));
    expect(ok.success).toBe(true);
    if (ok.success) expect((ok.data.blocks[0] as { style?: unknown }).style).toEqual({ anim: "zoom", pad: "roomy" });
    // a section without style is unchanged (old sites)
    const old = siteSchema.safeParse(site([hero, contact]));
    expect(old.success && (old.data.blocks[0] as { style?: unknown }).style).toBeFalsy();
    // the block data is still validated as before
    expect(siteBlockStyledSchema.safeParse({ type: "hero", data: { title: 5 } }).success).toBe(false);
    // the new site-wide design keys are kept; a bad value is dropped
    const th = siteSchema.safeParse(site([hero, contact], { accent: "#3366E6", mode: "light", buttons: "glass", hover: "tilt", entrance: "blur", header: "nope" }));
    expect(th.success && th.data.theme).toMatchObject({ buttons: "glass", hover: "tilt", entrance: "blur" });
    expect(th.success && (th.data.theme as { header?: string }).header).toBeUndefined();
  });

  it("clean styles and data attributes for the renderer (defaults are not written)", () => {
    expect(cleanSectionStyle({ anim: "auto", bg: "auto", pad: "auto", hide: "none" })).toBeNull();
    expect(cleanSectionStyle({ bg: "dark", anim: "blur", hide: "mobile" })).toEqual({ bg: "dark", anim: "blur", hide: "mobile" });
    expect(sectionStyleAttrs({ bg: "gradient", align: "center" })).toEqual({ "data-sbg": "gradient", "data-salign": "center" });
    expect(sectionStyleAttrs(null)).toBeNull();
    expect(resolveTheme({ buttons: "pill", entrance: "flip", hover: "bad" })).toMatchObject({ buttons: "pill", entrance: "flip", hover: undefined });
  });

  it("style packs: a whole look + section rhythm in one step; content, colour and mode stay", () => {
    expect(STYLE_PACKS.length).toBe(8);
    const s = site([hero, features, testimonials, faq, contact], { accent: "#C9A24D", mode: "light" });
    const out = applyStylePack(s as never as { theme: Record<string, unknown>; blocks: (TB & { style?: never })[] }, "elegant") as unknown as { theme: Record<string, unknown>; blocks: TB[] };
    expect(out.theme).toMatchObject({ accent: "#C9A24D", mode: "light", font: "frank", buttons: "outline", hover: "glow", entrance: "fade", header: "minimal" });
    expect(out.blocks[0]!.style).toEqual({ anim: "fade" });
    expect(out.blocks.find((b) => b.type === "testimonials")!.style).toMatchObject({ bg: "dark", anim: "blur" });
    expect(out.blocks.map((b) => b.data)).toEqual(s.blocks.map((b) => b.data));
    // hand-styled sections can be kept
    const manual = applyStylePack({ ...s, blocks: [{ ...features, style: { bg: "accent" as const } }] } as never, "minimal", { keepManual: true }) as unknown as { blocks: TB[] };
    expect(manual.blocks[0]!.style).toEqual({ bg: "accent" });
    // every pack uses a font with Hebrew letters
    for (const p of STYLE_PACKS) expect(["rubik", "heebo", "assistant", "frank", "secular", "varela", "suez", "noto-serif"]).toContain(packTheme(p).font);
  });

  it("never two heavy bands in a row; the right pack for a template / style", () => {
    const r = balanceRhythm([{ style: { bg: "dark" as const } }, { style: { bg: "accent" as const } }, { style: { bg: "dark" as const } }]);
    expect(r.map((b) => b.style?.bg)).toEqual(["dark", "tint", "dark"]);
    expect(packFor("luxe")).toBe("elegant");
    expect(packFor("neon")).toBe("tech");
    expect(packFor("classic", null, "law")).toBe("corporate");
    expect(packFor("whatever")).toBe("corporate");
  });

  it("the AI keeps / sets section design: new sites are designed from the first minute, AI answers keep style", () => {
    const n = normalizeAiSite({ name: "x", accent: "#112233", buttons: "glass", entrance: "blur", blocks: [{ ...hero, style: { bg: "dark", anim: "zoom" } }, { ...contact, style: { pad: "weird" } }] }, "full", { forms: [], bookings: [] } as never, "x", { keepOrder: true });
    expect(n!.theme).toMatchObject({ buttons: "glass", entrance: "blur" });
    expect((n!.blocks[0] as { style?: unknown }).style).toEqual({ bg: "dark", anim: "zoom" });
    expect((n!.blocks[1] as { style?: unknown }).style).toBeUndefined();
    const { site: built, applied } = polishBuiltSite({ name: "x", theme: { accent: "#123456", mode: "dark", template: "luxe" }, seo: { title: "t", description: "d" }, blocks: [hero, features, testimonials, contact] } as unknown as PolishableSite, parseBuildDirectives(""), { locale: "he", templates: ["luxe", "classic"], maxBlocks: 12 });
    expect(applied).toContain("design:elegant");
    expect((built.theme as Record<string, unknown>).entrance).toBe("fade");
    expect((built.blocks as { type: string; style?: { bg?: string } }[]).find((b) => b.type === "testimonials")!.style?.bg).toBe("dark");
  });

  it("wiring: renderer, CSS, editor (inspector + packs + load keeps style), AI prompts, grouped quick edits, i18n", () => {
    const pro = read("components/websites/site-pro.tsx");
    expect(pro).toContain("withSectionStyle(renderBlock(b, i), b)");
    expect(pro).toContain("data-motion={th.entrance ?? th.tpl.motion}");
    const css = read("components/websites/site-pro.css");
    for (const k of ['[data-sbg="dark"]', '[data-sanim="blur"]', '[data-shide="mobile"]', '[data-btn="glass"]', '[data-hover="tilt"]', '[data-hdr="minimal"]', 'data-motion="flip"']) expect(css, k).toContain(k);
    expect(read("components/websites/site-builder.tsx")).toContain("<SectionDesign index={i} value={b.style}");
    expect(read("components/websites/site-builder.tsx")).toContain("<StylePacks value={v}");
    const page = read("app/[locale]/(dashboard)/websites/[id]/page.tsx");
    expect(page).toContain("cleanSectionStyle(b.style)");
    expect(page).toContain("SITE_ENTRANCES.includes(theme.entrance as never)");
    expect(read("lib/ai/site-json.ts")).toContain("Every block MAY carry");
    expect(read("lib/ai/site-edit.ts")).toContain("balanceRhythm(");
    const panel = read("components/websites/ai-edit-panel.tsx");
    const quick = panel.match(/const QUICK = \[([^\]]+)\]/)![1]!.match(/"(\w+)"/g)!.map((x) => x.replace(/"/g, ""));
    const grouped = panel.match(/const QUICK_GROUPS[\s\S]+?\n\};/)![0];
    for (const q of quick) expect(grouped, q).toContain(`"${q}"`);
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).websites;
      for (const q of quick) {
        expect(typeof d.aiEdit.quick[q], `${l}.quick.${q}`).toBe("string");
        expect(typeof d.aiEdit.quickLabel[q], `${l}.label.${q}`).toBe("string");
      }
      for (const g of ["design", "sections", "content", "language"]) expect(typeof d.aiEdit.groups[g]).toBe("string");
      for (const p of STYLE_PACKS) {
        expect(typeof d.stylePacks.items[p], `${l}.${p}`).toBe("string");
        expect(typeof d.stylePacks.desc[p], `${l}.desc.${p}`).toBe("string");
      }
      for (const k of ["bgs", "anims", "pads", "aligns", "hides"]) expect(typeof d.sectionDesign[k]).toBe("object");
      for (const k of ["buttons", "hover", "entrance", "header", "fromTemplate"]) expect(typeof d.design[k], `${l}.${k}`).toBe("string");
    }
  });
});

describe("platform design 2.0 — CSS only, layered, safe for dialogs", () => {
  it("animations use transform / opacity only, keep nothing after they end, and live in the components layer", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("design 2.0"));
    expect(block).toContain("@layer components {");
    for (const k of ["d2-card-in", "d2-float", "d2-spin"]) {
      const kf = block.match(new RegExp(`@keyframes ${k} \\{[^\\n]*\\}`))?.[0] ?? "";
      expect(kf, k).not.toBe("");
      expect(kf, k).not.toMatch(/\btranslate:/);
    }
    expect(block).toContain("animation: d2-card-in 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;");
    expect(block).toContain("prefers-reduced-motion: no-preference");
    // the earlier hover lift is layered too, so a centering translate utility always wins
    expect(css).toContain("@layer components { .btn-brand:hover:not(:disabled) { translate: 0 -1px; } }");
    expect(read("components/ui/primitives.tsx")).toContain("empty-icon");
    expect(read("components/settings/profile-pro.tsx")).toContain("avatar-ring");
  });
});

describe("style packs never stack two dark bands", () => {
  it("cinematic on a long site alternates instead of stacking dark sections", () => {
    const types = ["hero", "features", "stats", "about", "testimonials", "steps", "faq", "cta", "contact"];
    const out = applyStylePack({ theme: {}, blocks: types.map((type) => ({ type })) }, "cinematic");
    const bgs = out.blocks.map((b) => (b as { style?: { bg?: string } }).style?.bg ?? "plain");
    for (let i = 1; i < bgs.length; i++) expect(["dark", "accent"].includes(bgs[i]!) && ["dark", "accent"].includes(bgs[i - 1]!), `${i}: ${bgs.join(",")}`).toBe(false);
  });
});
