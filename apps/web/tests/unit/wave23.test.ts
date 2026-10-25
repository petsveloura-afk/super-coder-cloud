import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_STEPS, guideLinks, isGuidePath, stepForPath } from "@/lib/guide/map";
import { NAV_ITEMS } from "@/lib/navigation";

const pub = path.join(import.meta.dirname, "../../public/guide");
const data = JSON.parse(readFileSync(path.join(pub, "guide-data.js"), "utf8").replace(/^[\s\S]*?window\.SCC_GUIDE = /, "").trim().replace(/;$/, "")) as {
  steps: { img: string; title: string; list: string[]; marks: { n: number; x: number; y: number; w: number; h: number; text: string }[] }[];
};

describe("wave 23 — the user guide inside the app", () => {
  it("every guide step has a real screenshot, a title, and markers inside the picture", () => {
    expect(data.steps).toHaveLength(29);
    for (const s of data.steps) {
      expect(s.img.startsWith("/guide/img/")).toBe(true);
      expect(existsSync(path.join(pub, "img", path.basename(s.img)))).toBe(true);
      expect(s.title.length).toBeGreaterThan(3);
      for (const m of s.marks) {
        expect(m.n).toBeGreaterThanOrEqual(1);
        expect(m.n).toBeLessThanOrEqual(s.list.length);
        expect(m.text).toBe(s.list[m.n - 1]);
        expect(m.x).toBeGreaterThan(-5);
        expect(m.x + m.w).toBeLessThan(105);
      }
    }
  });
  it("each step links to the screen it explains, and the mapping knows every step", () => {
    const keys = data.steps.map((s) => path.basename(s.img, ".webp"));
    expect(new Set(GUIDE_STEPS)).toEqual(new Set(keys));
    const l = guideLinks("he");
    expect(l["s09-inbox"]).toBe("/he/inbox");
    expect(l["s20-agent-setup"]).toBe("/he/ai-agents");
    expect(l["s01-signup"]).toBeNull();
  });
  it("the help button opens the step for the screen you are on", () => {
    expect(stepForPath("/he/inbox")).toBe("s09-inbox");
    expect(stepForPath("/he/crm")).toBe("s11-crm");
    expect(stepForPath("/he/crm/123e4567")).toBe("s12-contact");
    expect(stepForPath("/en/ai-agents/abc/setup")).toBe("s20-agent-setup");
    expect(stepForPath("/he/ai-agents")).toBe("s04-quick-agent");
    expect(stepForPath("/ar/integrations")).toBe("s05-wa-hero");
    expect(stepForPath("/he/finance")).toBeNull();
    for (const k of ["overview", "pipelines", "tasks", "appointments", "automations", "campaigns", "websites", "analytics", "team", "billing", "settings"]) expect(GUIDE_STEPS).toContain(stepForPath(`/he/${k}`));
    expect(isGuidePath("/he/guide")).toBe(true);
    expect(isGuidePath("/he/guide#s09-inbox")).toBe(true);
    expect(isGuidePath("/he/guides-x")).toBe(false);
  });
  it("the guide is in the menu for every member (no permission)", () => {
    const g = NAV_ITEMS.find((n) => n.key === "guide");
    expect(g?.permission).toBeUndefined();
    expect(g?.phase).toBeNull();
  });
});
