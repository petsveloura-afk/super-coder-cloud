import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AD_ASPECTS, AD_PALETTES, AD_STYLES, adLayout, adSize, adVisualPrompt, brushPoints, fitFont, parseAdCopy, priceFrom } from "@/lib/social/ad-creative-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("ad creative studio — agency-level posters", () => {
  it("a price appears ONLY when the person wrote it (the AI never invents one)", () => {
    expect(priceFrom('דף נחיתה החל מ-450 ש"ח', "450₪")).toBe("450₪");
    expect(priceFrom("דף נחיתה מקצועי", "450₪")).toBe("");
    expect(priceFrom("only $129 today", "$129")).toBe("129$");
    expect(priceFrom("1,200 שקל", "1,200")).toBe("1,200₪");
  });

  it("reads the copywriter's JSON (bad icons → check, max 4 benefits, length limits)", () => {
    const c = parseAdCopy('```json\n{"headline":"SUPER CODER","sub":"העסק שלכם ברמה אחרת","badge":"דף נחיתה","price":"999₪","features":[{"label":"מהיר","icon":"bolt"},{"label":"נייד","icon":"ufo"},{"label":"א","icon":"star"},{"label":"ב","icon":"star"},{"label":"ג","icon":"star"}],"cta":"הזמינו","tagline":"x"}\n```', "דף נחיתה");
    expect(c).toMatchObject({ headline: "SUPER CODER", price: "", cta: "הזמינו" });
    expect(c!.features).toHaveLength(4);
    expect(c!.features[1]!.icon).toBe("check");
    expect(parseAdCopy("no json", "x")).toBeNull();
    expect(parseAdCopy('{"sub":"x"}', "x")).toBeNull();
  });

  it("every frame: all boxes inside the canvas; wide frames put the text on the reading side", () => {
    for (const a of AD_ASPECTS)
      for (const rtl of [true, false]) {
        const { w, h } = adSize(a);
        const L = adLayout(a, rtl);
        for (const [k, b] of Object.entries(L)) {
          if (typeof b !== "object") continue;
          expect(b.x, `${a} ${k}`).toBeGreaterThanOrEqual(0);
          expect(b.y, `${a} ${k}`).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w, `${a} ${k}`).toBeLessThanOrEqual(w + 1);
          expect(b.y + b.h, `${a} ${k}`).toBeLessThanOrEqual(h + 1);
        }
      }
    expect(adLayout("16:9", true).col.x).toBeGreaterThan(800);
    expect(adLayout("16:9", false).col.x).toBeLessThan(200);
  });

  it("text fitting shrinks to the box; the brush stroke is deterministic", () => {
    const m = (s: string, px: number) => s.length * px * 0.55;
    const f = fitFont("SUPER CODER CLOUD", { w: 600, h: 200 }, m, { max: 180, min: 30, maxLines: 2 });
    expect(f.lines.length).toBeLessThanOrEqual(2);
    for (const l of f.lines) expect(m(l, f.px)).toBeLessThanOrEqual(600);
    expect(brushPoints({ x: 0, y: 0, w: 100, h: 40 }, 3)).toEqual(brushPoints({ x: 0, y: 0, w: 100, h: 40 }, 3));
  });

  it("the key visual has no text and leaves room on the right side; six styles with full palettes", () => {
    const p = adVisualPrompt("a laptop showing a landing page", "neon", "16:9", true);
    expect(p).toContain("Strictly no text");
    expect(p).toContain("right half dark and empty");
    for (const s of AD_STYLES) expect(Object.keys(AD_PALETTES[s]).length).toBeGreaterThanOrEqual(10);
  });

  it("wiring: a button in the post tools, the action meters credits through the usual paths, i18n", () => {
    expect(read("components/social/post-power.tsx")).toContain("<AdCreativeStudio body={props.body} image={props.image} ig={props.ig} onImage={props.setImage} />");
    const a = read("app/[locale]/(dashboard)/social/ad-actions.ts");
    expect(a).toContain("runAISystem(");
    expect(a).toContain("generateMeteredImage(");
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).social;
      expect(typeof d.power.ad).toBe("string");
      for (const s of AD_STYLES) expect(typeof d.ad.styles[s], `${l}.${s}`).toBe("string");
      for (const k of ["headline", "sub", "badge", "pricePrefix", "price", "ribbon", "cta", "tagline"]) expect(typeof d.ad.fields[k], `${l}.${k}`).toBe("string");
    }
  });
});
