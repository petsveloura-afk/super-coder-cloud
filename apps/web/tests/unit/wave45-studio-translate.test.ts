import { describe, expect, it } from "vitest";
import { cleanTranslation, needsEnglishTopic } from "@/lib/social/studio-core";

describe("wave 45 — image topic translation helpers", () => {
  it("detects Hebrew and Arabic topics, not English ones", () => {
    expect(needsEnglishTopic("לחם טרי פרוס על השולחן")).toBe(true);
    expect(needsEnglishTopic("خبز طازج على الطاولة")).toBe(true);
    expect(needsEnglishTopic("fresh sliced bread on a wooden table")).toBe(false);
  });
  it("cleans a translation and falls back to the original when empty", () => {
    expect(cleanTranslation('  "Fresh sliced bread\n on a table"  ', "x")).toBe("Fresh sliced bread on a table");
    expect(cleanTranslation("", "לחם")).toBe("לחם");
    expect(cleanTranslation(null, "לחם")).toBe("לחם");
    expect(cleanTranslation("a".repeat(500), "x").length).toBe(300);
  });
});
