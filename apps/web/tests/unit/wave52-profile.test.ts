import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AVATAR_MAX_BYTES, avatarCheck, cleanPhone, isOwnAvatarUrl, profileCompleteness } from "@/lib/profile/profile-core";

const root = path.resolve(__dirname, "../../../..");

describe("wave 52 — personal profile pro", () => {
  it("avatar rules", () => {
    expect(avatarCheck({ type: "image/png", size: 1000 })).toEqual({ ok: true, ext: "png" });
    expect(avatarCheck({ type: "image/gif", size: 1000 })).toEqual({ ok: false, error: "type" });
    expect(avatarCheck({ type: "image/jpeg", size: AVATAR_MAX_BYTES + 1 })).toEqual({ ok: false, error: "size" });
  });
  it("only the person's own avatar folder is accepted", () => {
    const base = "https://abc.supabase.co";
    expect(isOwnAvatarUrl(`${base}/storage/v1/object/public/avatars/u1/x.png`, "u1", base)).toBe(true);
    expect(isOwnAvatarUrl(`${base}/storage/v1/object/public/avatars/u2/x.png`, "u1", base)).toBe(false);
    expect(isOwnAvatarUrl(`${base}/storage/v1/object/public/avatars/u1/../u2/x.png`, "u1", base)).toBe(false);
    expect(isOwnAvatarUrl("https://evil.test/avatars/u1/x.png", "u1", base)).toBe(false);
  });
  it("completeness and phone cleaning", () => {
    expect(profileCompleteness({ full_name: "Tom" }).pct).toBe(20);
    expect(profileCompleteness({ full_name: "Tom", avatar_url: "x", job_title: "CEO", phone: "050", bio: "hi" })).toEqual({ pct: 100, missing: [] });
    expect(cleanPhone("050-123-4567")).toBe("050-123-4567");
    expect(cleanPhone("abc")).toBeNull();
    expect(cleanPhone("12")).toBeNull();
  });
  it("migration is additive", () => {
    const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261029000006_profile_pro.sql"), "utf8");
    expect(sql).toMatch(/add column if not exists job_title/);
    expect(sql).toMatch(/avatars own upload/);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function)\b/i);
  });
});
