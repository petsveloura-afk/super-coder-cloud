import { describe, expect, it } from "vitest";
import { buildTextBrief, validateVariants } from "@/lib/social/studio-core";

describe("wave 45 — studio text options", () => {
  it("brief asks to write about the subject, not repeat it", () => {
    const b = buildTextBrief({ topic: "לחם טרי", tone: "friendly", platform: "facebook", langName: "Hebrew" });
    expect(b).toContain("Subject of the post: לחם טרי");
    expect(b).toContain("Do not just repeat");
  });
  it("drops echoes of the topic, too-short answers and duplicates", () => {
    const real = "אצלנו מתחילים את הבוקר עם לחם טרי מהתנור, פריך מבחוץ ורך מבפנים. בואו לטעום! #לחם";
    expect(validateVariants(["לחם טרי", "לחם טרי!", real, real], "לחם טרי")).toEqual([real]);
  });
  it("drops a copy of the text already on screen", () => {
    const cur = "אצלנו מתחילים את הבוקר עם לחם טרי מהתנור, פריך מבחוץ ורך מבפנים. בואו לטעום!";
    expect(validateVariants([cur], "לחם", cur)).toEqual([]);
  });
});
