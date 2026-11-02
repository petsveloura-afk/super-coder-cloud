import { describe, expect, it } from "vitest";
import { firstJsonObjectTolerant } from "@/lib/team/json-repair-core";
import { parsePlanModel, parseVerdict } from "@/lib/team/engine-core";

const good = { understanding: "להעלות פוסטים", steps: [{ tool: "crm.search", args: { q: "x" }, why: "w" }], deliverable: { type: "text" } };

describe("plan recovery for weak / fallback models (upgrade 6)", () => {
  it("valid JSON is unchanged", () => {
    expect(parsePlanModel(JSON.stringify(good))?.steps).toHaveLength(1);
  });
  it("reads shapes the strict parser rejects", () => {
    const shapes = [
      `{"understanding": "שורה\nשנייה", "steps": []}`,
      `{"understanding": "חברת דוגמה בע"מ מזמינה", "steps": [],}`,
      "```json\n" + `{"understanding": "ok", "steps": [],}` + "\n```",
      `{"understanding": "ok", "steps": [{"tool": "crm.search", "args": {"q": "x"}, "why": "w"}], "risks": ["a", "b`,
      `{"understanding": "ok", "question": null, "steps": [{"tool": "crm.search", "args": {}}], "estimate": {"credits": 3, "mi`,
    ];
    for (const raw of shapes) expect(parsePlanModel(raw), raw).not.toBeNull();
  });
  it("never invents content and returns null for text without JSON", () => {
    expect(firstJsonObjectTolerant("sorry, I cannot")).toBeNull();
    expect(firstJsonObjectTolerant("")).toBeNull();
    expect(parsePlanModel("no json here")).toBeNull();
  });
  it("reviewer verdict survives a cut-off answer", () => {
    expect(parseVerdict(`{"verdict": "revise", "issues": ["a", "b`).verdict).toBe("revise");
  });
});
