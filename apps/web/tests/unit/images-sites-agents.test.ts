import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ART_DIRECTOR_SYSTEM, artDirectorUser, aspectFor, composeImagePrompt, defaultBrief, detectIndustry, mergeBrief, paletteWords, parseBrief, pickStyle, stockSeed } from "@/lib/ai/image-director-core";
import { countTarget, formatCount } from "@/lib/site/effects-core";
import { stockQuery } from "@/lib/social/image-providers-core";
import { photoQuery } from "@/lib/ai/site-tools-core";
import { resolveTheme } from "@/lib/site/templates";
import { analyzeMessage } from "@/lib/ai/intelligence";
import { siteSchema } from "@scc/shared/engagement";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("image director — professional prompts", () => {
  it("knows the business from a Hebrew request and shows its real service", () => {
    expect(detectIndustry("פוסט על צבע לשיער חדש במספרה")?.key).toBe("salon");
    expect(detectIndustry("מבצע על השתלות שיניים")?.key).toBe("dental");
    expect(detectIndustry("מסעדה איטלקית בחיפה")?.key).toBe("restaurant");
    expect(detectIndustry("כלבים מקבלים תספורת")?.key).toBe("pets");
    expect(detectIndustry("")).toBeNull();
    const b = defaultBrief({ request: "פוסט על צבע לשיער", purpose: "post" });
    expect(b.subject).toMatch(/hairstylist/);
    expect(b.setting).toMatch(/salon/);
  });

  it("a full art-direction prompt: subject first (stock search uses it), camera, light, palette, quality, no text", () => {
    const d = composeImagePrompt({ subject: "a hairstylist applying a glossy caramel balayage to a smiling woman", setting: "a bright boutique salon" }, { request: "balayage", purpose: "post", platform: "instagram", brandColors: ["#9B5DE5"] });
    expect(d.prompt.startsWith("Professional photograph: a hairstylist applying")).toBe(true);
    for (const part of ["Camera:", "Lighting:", "Composition:", "Color palette:", "Mood:", "Ultra-detailed", "Strictly no text", "no warped hands"]) expect(d.prompt).toContain(part);
    expect(d.prompt).toContain("violet");
    expect(d.aspect).toBe("1:1");
    expect(d.prompt.length).toBeLessThanOrEqual(1750);
    // the stock-photo fallbacks search on the subject, not on style words
    expect(stockQuery(d.prompt)).toMatch(/hairstylist/);
    expect(photoQuery(d.prompt.split(":").slice(1).join(":"))).toMatch(/hairstylist|caramel|balayage/);
  });

  it("the right frame and style for where the picture goes", () => {
    expect(aspectFor("hero")).toBe("16:9");
    expect(aspectFor("story")).toBe("9:16");
    expect(aspectFor("post", "instagram")).toBe("1:1");
    expect(aspectFor("post", "facebook")).toBe("16:9");
    expect(pickStyle("auto", "product", null)).toBe("product");
    expect(pickStyle("auto", "post", detectIndustry("דירה למכירה"))).toBe("luxury");
    expect(pickStyle("illustration", "post", null)).toBe("illustration");
    const hero = composeImagePrompt(defaultBrief({ request: "מרפאת שיניים", purpose: "hero" }), { request: "מרפאת שיניים", purpose: "hero" });
    expect(hero.prompt).toContain("empty space on the other side for a headline");
  });

  it("reads the art director's JSON; Hebrew values never reach the image model; gaps are filled", () => {
    const ai = parseBrief('```json\n{"subject": "a chef plating pasta", "lighting": "warm candle light", "palette": "תכלת", "style": "lifestyle", "details": ["steam", "בזיליקום"]}\n```');
    const m = mergeBrief(ai, defaultBrief({ request: "מסעדה", purpose: "post" }));
    expect(m.subject).toBe("a chef plating pasta");
    expect(m.lighting).toBe("warm candle light");
    expect(m.palette).toBeUndefined();
    expect(m.style).toBe("lifestyle");
    expect(m.details).toEqual(["steam"]);
    expect(parseBrief("no json here")).toBeNull();
    expect(paletteWords(["#C9A24D", "#111111", "bad"])).toMatch(/yellow|orange/);
    expect(ART_DIRECTOR_SYSTEM).toContain("Never put text");
    expect(artDirectorUser({ request: "פוסט", purpose: "hero", brandColors: ["#2563EB"] })).toContain("blue");
  });

  it("site photos: a Hebrew brief gives a real scene to search, not the word 'business'", () => {
    expect(stockSeed("", "אתר למספרה בתל אביב")).toMatch(/hairstylist/);
    expect(stockSeed("a modern dental clinic", "")).toBe("a modern dental clinic");
    expect(stockSeed(null, "עסק כלשהו")).toMatch(/business|customers/);
  });

  it("wiring: every image entry point goes through the director, Gemini gets the aspect ratio", () => {
    const img = read("lib/ai/images.ts");
    expect(img).toContain("imageConfig: { aspectRatio: aspect }");
    expect(img).toContain("body = plainBody;");
    const studio = read("app/[locale]/(dashboard)/social/studio-actions.ts");
    expect(studio.match(/directedPostPrompt\(/g)?.length).toBe(3);
    expect(read("lib/social/brain.ts").match(/directedPostPrompt\(/g)?.length).toBe(2);
    const sb = read("lib/ai/site-builder.ts");
    expect(sb).toContain('purpose: "hero"');
    expect(sb).toContain('{ aspectRatio: "16:9" }');
    expect(sb).toContain("m.stockSeed(site.imagePrompt, input.brief)");
    expect(read("lib/social/studio-image.ts")).toContain('aspectRatio ?? (platform === "instagram" ? "1:1" : "16:9")');
  });
});

describe("sites — effects pack and more editing", () => {
  it("counting numbers keep the exact shape of the value", () => {
    const t = countTarget("1,200+")!;
    expect(t).toMatchObject({ value: 1200, suffix: "+", grouping: true });
    expect(formatCount(t, 600)).toBe("600+");
    expect(formatCount(t, 1200)).toBe("1,200+");
    expect(formatCount(countTarget("98%")!, 49)).toBe("49%");
    expect(formatCount(countTarget("4.9★")!, 2.45)).toBe("2.5★");
    expect(formatCount(countTarget("₪350")!, 350)).toBe("₪350");
    expect(countTarget("15 שנים")).toMatchObject({ value: 15, suffix: " שנים" });
    expect(countTarget("24/7")).toMatchObject({ value: 24 });
    expect(countTarget("ללא מספר")).toBeNull();
  });

  it("theme: effects default to subtle, off without animations; saved themes keep effects and dividers", () => {
    expect(resolveTheme({}).effects).toBe("subtle");
    expect(resolveTheme({ animations: false, effects: "rich" }).effects).toBe("none");
    expect(resolveTheme({ effects: "rich", dividers: "wave" })).toMatchObject({ effects: "rich", dividers: "wave" });
    expect(resolveTheme({ dividers: "zigzag" }).dividers).toBe("none");
    const ok = siteSchema.safeParse({ name: "x", slug: "abc-site", theme: { accent: "#123456", mode: "light", effects: "rich", dividers: "curve" }, blocks: [{ type: "hero", data: { title: "t" } }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.theme).toMatchObject({ effects: "rich", dividers: "curve" });
  });

  it("the renderer, the client island, the design panel and the AI prompt all know the effects", () => {
    expect(read("components/websites/site-pro.tsx")).toContain('data-fx={th.effects ?? "subtle"}');
    expect(read("components/websites/site-pro.tsx")).toContain("<SiteEffects rootId={rootId} level={th.effects} />");
    const css = read("components/websites/site-pro.css");
    for (const k of [".fx-progress", ".fx-top", "scs-aurora", 'data-div="wave"', "animation-timeline: view()", "prefers-reduced-motion: no-preference"]) expect(css, k).toContain(k);
    const fx = read("components/websites/site-effects.tsx");
    for (const k of ["prefers-reduced-motion", "a11y-still", "IntersectionObserver", "MutationObserver", "pointermove"]) expect(fx, k).toContain(k);
    expect(read("components/websites/design-panel.tsx")).toContain('data-testid="ds-effects"');
    expect(read("lib/ai/site-json.ts")).toContain('"effects": "rich"');
    expect(read("lib/ai/site-build-rules.ts")).toContain('site.theme.effects = site.theme.animations === false ? "none"');
  });

  it("more one-click AI edits, in three languages", () => {
    const p = read("components/websites/ai-edit-panel.tsx");
    const keys = ["wow", "waves", "darkLux", "colorful", "gallery", "team", "headline", "mobile", "elegantFont", "story"];
    for (const k of keys) expect(p).toContain(`"${k}"`);
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of keys) {
        expect(typeof d.websites.aiEdit.quick[k], `${l}.quick.${k}`).toBe("string");
        expect(typeof d.websites.aiEdit.quickLabel[k], `${l}.label.${k}`).toBe("string");
      }
      for (const k of ["effects", "effectsHint", "effectsNone", "effectsSubtle", "effectsRich", "dividers", "dividersWave"]) expect(typeof d.websites.design[k], `${l}.${k}`).toBe("string");
    }
    expect(read("lib/ai/site-edit.ts")).toContain("freeSiteImages(input.orgId");
  });
});

describe("agents — found in live tests and fixed", () => {
  it("Hebrew stop requests are understood ('הסר אותי'), ordinary sentences are not", () => {
    for (const t of ["הסר אותי בבקשה", "תסירו אותי מהרשימה", "תפסיק לשלוח לי", "הוציאו אותי מהרשימה", "remove me"]) expect(analyzeMessage(t).intents, t).toContain("unsubscribe");
    for (const t of ["אפשר להסיר את הלק?", "הסר את התור של מחר?", "תשלחו לי את המחיר"]) expect(analyzeMessage(t).intents, t).not.toContain("unsubscribe");
  });

  it("the quick retry after an empty answer passes the same price check (an invented price never goes out)", () => {
    const a = read("lib/ai/autopilot.ts");
    expect(a).toContain("const rc = checkReply({ reply: retryTools.text");
    expect(a).toContain('p_reason: "guardrail_price" });\n            return { replied: true, handoff: true, reason: "guardrail_price", text: safe };');
  });

  it("the phone agent asks the caller to repeat on a busy moment instead of hanging up", () => {
    const v = read("lib/voice/agent.ts");
    expect(v).toContain("לא קלטתי לרגע — אפשר לחזור על זה?");
    expect(v).toContain("if (!out.ok && lastAgent !== hold && input.callerText)");
  });
});
