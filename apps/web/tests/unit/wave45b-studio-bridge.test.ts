import { describe, expect, it } from "vitest";
import { STUDIO_STYLES, buildSceneImagePrompt, goalDirection, parseFullPost, postChecklist, postToSceneSeed, styleDirection } from "@/lib/social/studio-core";

describe("wave 45 / stage B — text → image bridge & full post", () => {
  it("turns a finished post into a clean image seed (no hashtags, links, emojis)", () => {
    const post = "האם שמתם לב איך עץ ירוק וזוהר מביא תחושה של רעננות? 🌿 #טבע_מרגיע #השראה\n➡️ שתפו אותנו https://x.test/a";
    const seed = postToSceneSeed(post);
    expect(seed).toContain("עץ ירוק וזוהר");
    expect(seed).not.toMatch(/#|https|🌿/);
    expect(seed.length).toBeLessThanOrEqual(400);
    expect(postToSceneSeed("")).toBe("");
  });

  it("scene prompt keeps the no-text rule, the shape and the chosen style", () => {
    const p = buildSceneImagePrompt({ scene: "a glowing green tree in a calm living room", platform: "instagram", style: "cinematic", business: "Shop" });
    expect(p).toContain("glowing green tree");
    expect(p).toContain("1:1");
    expect(p).toMatch(/Cinematic/);
    expect(p).toMatch(/No text/);
    expect(buildSceneImagePrompt({ scene: "x", platform: "facebook", style: "auto" })).toContain("1.91:1");
    expect(styleDirection("auto")).toBe("");
    expect(STUDIO_STYLES).toContain("photo");
  });

  it("parses the full-post JSON, with fences, and falls back to plain text", () => {
    const j = parseFullPost('```json\n{"post":"שורה 1\\nשורה 2 #תג","scene":"bread on a table","headline":"לחם טרי","firstComment":"","alt":"לחם"}\n```');
    expect(j?.post).toBe("שורה 1\nשורה 2 #תג");
    expect(j?.scene).toBe("bread on a table");
    expect(j?.firstComment).toBeNull();
    expect(parseFullPost("just a plain post here")?.post).toBe("just a plain post here");
    expect(parseFullPost("   ")).toBeNull();
    expect(parseFullPost('{"post":"' + "a".repeat(50) + '"}', 10)?.post).toHaveLength(10);
  });

  it("goal direction and checklist", () => {
    expect(goalDirection("sell")).toMatch(/sale/);
    expect(goalDirection(undefined)).toMatch(/engagement/);
    const c = postChecklist("פתיח קצר\nגוף הפוסט עם מידע שימושי ללקוחות שלנו\nשלחו לנו הודעה! #טיפ", "facebook", false);
    expect(c).toEqual({ hook: true, cta: true, hashtags: true, length: true, image: true });
    expect(postChecklist("קצר", "instagram", false).image).toBe(false);
  });
});
