import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { composeCaption, ctaLine, ctaUrl, fbCallToAction, intlPhone, isRichPost, isVideoUrl, uploadCheck } from "@/lib/social/post-core";
import { dealReasonText } from "@/lib/deals/brain-text";

const root = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("wave 51 — rich social posts", () => {
  it("phones and button targets", () => {
    expect(intlPhone("050-123-4567")).toBe("972501234567");
    expect(intlPhone("+972 50 123 4567")).toBe("972501234567");
    expect(ctaUrl({ type: "message" }, { platform: "facebook", pageId: "123" })).toBe("https://m.me/123");
    expect(ctaUrl({ type: "message" }, { platform: "instagram", igUsername: "biz" })).toBe("https://ig.me/m/biz");
    expect(ctaUrl({ type: "whatsapp", value: "0501234567" }, { platform: "facebook" })).toBe("https://wa.me/972501234567");
    expect(ctaUrl({ type: "call", value: "0501234567" }, { platform: "facebook" })).toBe("tel:+972501234567");
    expect(ctaUrl({ type: "book", value: "https://x.test/book" }, { platform: "facebook" })).toBe("https://x.test/book");
    expect(ctaUrl({ type: "shop", value: "not a url" }, { platform: "facebook" })).toBeNull();
  });
  it("native Facebook buttons", () => {
    expect(fbCallToAction({ type: "message" }, null, "1")?.type).toBe("MESSAGE_PAGE");
    expect(fbCallToAction({ type: "learn_more" }, "https://x.test", "1")).toEqual({ type: "LEARN_MORE", value: { link: "https://x.test" } });
    expect(fbCallToAction({ type: "shop" }, null, "1")).toBeNull();
  });
  it("captions per platform, never duplicating the link", () => {
    const fb = composeCaption({ body: "מבצע!", link: "https://x.test", cta: { type: "message" }, platform: "facebook", lang: "he", pageId: "9" });
    expect(fb).toContain("🔗 https://x.test");
    expect(fb).toContain("https://m.me/9");
    const attached = composeCaption({ body: "מבצע!", link: "https://x.test", cta: { type: "message" }, platform: "facebook", lang: "he", linkAttached: true, ctaAttached: true });
    expect(attached).toBe("מבצע!");
    const ig = composeCaption({ body: "Sale", link: "https://x.test", cta: { type: "message" }, platform: "instagram", lang: "en" });
    expect(ig).toContain("Link in bio");
    expect(ig).not.toContain("https://x.test");
    expect(composeCaption({ body: "see https://x.test", link: "https://x.test", platform: "facebook", lang: "en" })).toBe("see https://x.test");
    expect(ctaLine({ type: "call", value: "0501234567" }, { platform: "instagram", lang: "he" })).toContain("+972501234567");
  });
  it("uploads: type and size rules", () => {
    expect(uploadCheck({ type: "image/jpeg", size: 1000 })).toEqual({ ok: true, ext: "jpg", kind: "image" });
    expect(uploadCheck({ type: "video/mp4", size: 40 * 1024 * 1024 })).toEqual({ ok: true, ext: "mp4", kind: "video" });
    expect(uploadCheck({ type: "video/mp4", size: 60 * 1024 * 1024 })).toEqual({ ok: false, error: "size" });
    expect(uploadCheck({ type: "application/pdf", size: 10 })).toEqual({ ok: false, error: "type" });
    expect(isVideoUrl("https://x/a.MP4?x=1")).toBe(true);
    expect(isRichPost({})).toBe(false);
    expect(isRichPost({ cta_type: "message" })).toBe(true);
  });
  it("migration is additive and idempotent", () => {
    const sql = read("supabase/migrations/20261029000005_social_posts_media.sql");
    expect(sql).toMatch(/add column if not exists link_url/);
    expect(sql).toMatch(/add column if not exists first_comment/);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function)\b/i);
    expect(sql).toMatch(/social media upload/);
  });
});

describe("wave 51 — pipelines smart list fix", () => {
  it("the server page no longer calls a function from a client module", () => {
    const page = read("apps/web/app/[locale]/(dashboard)/pipelines/page.tsx");
    expect(page).not.toMatch(/\breasonText\(/);
    expect(page).toContain("dealReasonText(");
    const t = (k: string) => k.split(".").pop()!;
    expect(dealReasonText(t, ["stale", "overdue"] as never)).toBe("stale · overdue");
  });
});

describe("wave 51b — the post editor keeps exactly one multi-line box (e2e: post-editor textarea)", () => {
  it("post extras use single-line inputs only", () => {
    const src = read("apps/web/components/social/post-extras.tsx");
    expect(src).not.toMatch(/<Textarea\b|<textarea\b/);
  });
});
