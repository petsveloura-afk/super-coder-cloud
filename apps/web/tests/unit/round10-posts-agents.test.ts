import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST_EDITS, changesLanguage, editDirection, isPostEdit, postStats, pushVersion, stripEmojis, stripHashtags, stripLinks } from "@/lib/social/post-edits-core";
import { DEFAULT_ADJUST, FRAMES, LOOKS, bandLayout, coverCrop, filterString, isRtlText, normalizeAdjust, readableOn, wrapLines } from "@/lib/social/image-edit-core";
import { CONTACT_STATUSES, ROLE_EXTRA_TOOLS10, UPGRADE10_TOOLS, pipelineSummary, threadSummary, validContactStatus, withRoleExtras10 } from "@/lib/team/tools-plus10-core";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { DELIVERY_RULES } from "@/lib/team/execution-plus-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const he = JSON.parse(read("lib/i18n/dictionaries/he.json"));
const en = JSON.parse(read("lib/i18n/dictionaries/en.json"));
const ar = JSON.parse(read("lib/i18n/dictionaries/ar.json"));

describe("post editor — quick edits (text)", () => {
  it("every edit has a direction; only translations may change the language; unknown edits are refused", () => {
    for (const e of POST_EDITS) {
      expect(editDirection(e, "facebook").length).toBeGreaterThan(40);
      expect(changesLanguage(e)).toBe(e.startsWith("translate_"));
    }
    expect(isPostEdit("warmer")).toBe(true);
    expect(isPostEdit("drop table")).toBe(false);
    expect(editDirection("platform_fit", "instagram")).toContain("2200");
    expect(editDirection("grammar", "facebook")).toMatch(/ONLY spelling/);
  });

  it("free clean-ups remove only what they say and keep the words", () => {
    const t = "מבצע סוף שבוע! 💇‍♀️ תספורת ב-120 ₪ 🇮🇱\nקבעו תור 📩 https://x.co/a #מספרה #מבצע";
    expect(stripEmojis(t)).toBe("מבצע סוף שבוע! תספורת ב-120 ₪\nקבעו תור https://x.co/a #מספרה #מבצע");
    expect(stripHashtags(t)).not.toContain("#");
    expect(stripHashtags(t)).toContain("תספורת ב-120 ₪");
    expect(stripLinks(t)).not.toContain("https://");
  });

  it("stats: characters left per network, the 'see more' preview, words and reading time", () => {
    const s = postStats("שורה ראשונה\nשורה שנייה\nשורה שלישית #תג https://a.b 😀", ["facebook", "instagram"]);
    expect(s.left.find((l) => l.platform === "instagram")!.left).toBe(2200 - s.chars);
    expect(s.hashtags).toBe(1);
    expect(s.links).toBe(1);
    expect(s.emojis).toBe(1);
    expect(s.cut).toBe(true);
    expect(s.preview).toBe("שורה ראשונה שורה שנייה");
    expect(postStats("x".repeat(3000), ["instagram"]).left[0]!.left).toBe(-800);
  });

  it("version history: newest first, no repeats, capped", () => {
    let h: string[] = [];
    h = pushVersion(h, "a");
    h = pushVersion(h, "a");
    h = pushVersion(h, "b");
    h = pushVersion(h, "a");
    expect(h).toEqual(["a", "b"]);
    for (let i = 0; i < 30; i++) h = pushVersion(h, `v${i}`);
    expect(h.length).toBe(12);
  });

  it("the action keeps the same guard as the rewrite (permissions, rate limit, metered AI, length limits)", () => {
    const src = read("app/[locale]/(dashboard)/social/edit-actions.ts");
    expect(src).toContain('ctx.can("campaigns.manage") || !ctx.can("ai.use")');
    expect(src).toContain("public_rate_limit");
    expect(src).toContain("runAISystem");
    expect(src).toContain("isPostEdit(input.edit)");
    // the existing rewrite is untouched
    expect(read("app/[locale]/(dashboard)/social/copy-actions.ts")).toContain("export async function rewritePostAction");
  });
});

describe("post editor — picture editor (math)", () => {
  it("frames are the recommended network sizes", () => {
    expect(FRAMES.portrait).toEqual({ w: 1080, h: 1350 });
    expect(FRAMES.story).toEqual({ w: 1080, h: 1920 });
  });

  it("cover crop stays inside the image, keeps the frame's shape and follows zoom + focus", () => {
    const src = { w: 4000, h: 3000 };
    const c = coverCrop(src, FRAMES.square);
    expect(c.sw).toBeCloseTo(3000);
    expect(c.sx).toBeCloseTo(500);
    const z = coverCrop(src, FRAMES.square, 2, 1, 0);
    expect(z.sw).toBeCloseTo(1500);
    expect(z.sx + z.sw).toBeCloseTo(4000);
    expect(z.sy).toBe(0);
    const story = coverCrop(src, FRAMES.story);
    expect(story.sw / story.sh).toBeCloseTo(1080 / 1920);
    expect(story.sx).toBeGreaterThanOrEqual(0);
  });

  it("adjustments are clamped and become one filter string; every look is valid", () => {
    expect(filterString(DEFAULT_ADJUST)).toBe("brightness(100%) contrast(100%) saturate(100%)");
    expect(normalizeAdjust({ brightness: 999, saturation: -5 })).toMatchObject({ brightness: 150, saturation: 0 });
    expect(filterString({ warmth: 20 })).toContain("sepia(16%)");
    expect(filterString({ warmth: -20 })).toContain("hue-rotate(-12deg)");
    for (const l of Object.values(LOOKS)) expect(normalizeAdjust(l)).toEqual(l);
  });

  it("headline: readable text color on any band, wrapping with an ellipsis, RTL detection, band inside the frame", () => {
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#111827")).toBe("#ffffff");
    expect(readableOn("bad")).toBe("#ffffff");
    const lines = wrapLines("one two three four five six seven eight nine ten eleven twelve", 10, (s) => s.length, 3);
    expect(lines.length).toBe(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
    expect(isRtlText("מבצע סוף שבוע 120")).toBe(true);
    expect(isRtlText("Weekend sale")).toBe(false);
    for (const pos of ["top", "center", "bottom"] as const) {
      const b = bandLayout(FRAMES.portrait, 3, pos);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(FRAMES.portrait.h);
    }
  });

  it("the edited picture is saved as a NEW file through the existing upload (the original is never overwritten)", () => {
    const src = read("components/social/image-editor.tsx");
    expect(src).toContain("createMediaUploadAction");
    expect(src).toContain('"x-upsert": "false"');
    const power = read("components/social/post-power.tsx");
    expect(power).toContain("<PostEditTools");
    expect(power).toContain("<ImageEditor");
    // the tools that were there stay
    for (const k of ["open-motion", "open-ad-studio", "open-ai-video", "open-post-quality"]) expect(power).toContain(k);
  });
});

describe("digital team — upgrade 10 tools", () => {
  it("are in the catalog, read-only or internal (nothing reaches a customer or costs money)", () => {
    for (const t of UPGRADE10_TOOLS) {
      expect(TOOL_MAP[t.key]).toBeDefined();
      expect(t.sensitivity).toBe("internal");
    }
    expect(TOOL_MAP["crm.find_contacts"]).toBeDefined(); // the old ones stay
  });

  it("role extras only ADD tools", () => {
    expect(withRoleExtras10("sales", ["crm.add_note"])).toEqual(expect.arrayContaining(["crm.add_note", "inbox.thread", "crm.set_status"]));
    expect(withRoleExtras10("custom", ["x"])).toEqual(["x"]);
    for (const list of Object.values(ROLE_EXTRA_TOOLS10)) for (const k of list) expect(TOOL_MAP[k]).toBeDefined();
    expect(read("lib/team/runner.ts")).toContain("withRoleExtras10(m.role_key, withRoleExtras9(");
  });

  it("status is one of four values; thread / pipeline summaries are readable and bounded", () => {
    expect(CONTACT_STATUSES).toEqual(["lead", "qualified", "customer", "inactive"]);
    expect(validContactStatus("Customer")).toBe("customer");
    expect(validContactStatus("vip")).toBeNull();
    const th = threadSummary([{ direction: "in", body: "שלום, יש תור מחר?", created_at: "2026-11-12T10:00:00Z" }, { direction: "out", body: "כן, ב-10", created_at: "2026-11-12T10:01:00Z" }]);
    expect(th).toContain("customer] שלום");
    expect(th).toContain("business] כן");
    expect(threadSummary([])).toBe("no messages with this contact");
    const p = pipelineSummary([{ id: "b", name: "Proposal", position: 2 }, { id: "a", name: "New", position: 1 }], [{ stage_id: "a", value: 100 }, { stage_id: "a", value: "50" }, { stage_id: "b", value: null }]);
    expect(p.lines).toEqual(["New: 2 deals, 150", "Proposal: 1 deals, 0"]);
    expect(p.openValue).toBe(150);
  });

  it("the executors are wired and scoped to the business; the delivery rules mention them; labels exist in 3 languages", () => {
    const tools = read("lib/team/tools.ts");
    for (const t of UPGRADE10_TOOLS) expect(tools).toContain(`case "${t.key}":`);
    const ex = read("lib/team/tools-plus10.ts");
    expect((ex.match(/\.eq\("organization_id", orgId\)/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(ex).toContain('.eq("status", "draft")');
    expect(DELIVERY_RULES).toContain("inbox.thread");
    expect(DELIVERY_RULES).toContain("social.drafts"); // the old rule stays
    for (const t of UPGRADE10_TOOLS) {
      const k = t.key.replace(".", "_");
      expect(he.aiTeam.tools[k]).toBeTruthy();
      expect(en.aiTeam.tools[k]).toBeTruthy();
      expect(ar.aiTeam.tools[k]).toBeTruthy();
    }
  });
});

describe("design & accessibility", () => {
  it("a skip-to-content link and a focusable main region in the app shell", () => {
    const shell = read("components/layout/app-shell.tsx");
    expect(shell).toContain('href="#main-content"');
    expect(shell).toContain('id="main-content"');
    expect(read("app/globals.css")).toContain(".skip-link:focus");
    expect(he.common.skipToContent).toBeTruthy();
  });
});
