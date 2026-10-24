import { describe, expect, it } from "vitest";
import { averageReplyMs, secondsLabel, startOfTodayIso } from "@/lib/dashboard/pulse-core";
import { setupProgress, setupSteps } from "@/lib/admin/setup-core";

describe("overview AI band", () => {
  it("midnight in the organization's time zone", () => {
    // 2026-10-23 08:30 in Israel (UTC+3) → midnight there = 2026-10-22T21:00Z
    expect(startOfTodayIso("Asia/Jerusalem", new Date("2026-10-23T05:30:00Z"))).toBe("2026-10-22T21:00:00.000Z");
    // 23:30 UTC is already the next day in Israel
    expect(startOfTodayIso("Asia/Jerusalem", new Date("2026-10-23T23:30:00Z"))).toBe("2026-10-23T21:00:00.000Z");
    expect(startOfTodayIso("UTC", new Date("2026-10-23T05:30:00Z"))).toBe("2026-10-23T00:00:00.000Z");
    expect(startOfTodayIso("America/New_York", new Date("2026-10-23T05:30:00Z"))).toBe("2026-10-23T04:00:00.000Z"); // 01:30 EDT
    expect(startOfTodayIso("Not/AZone", new Date("2026-10-23T05:30:00Z"))).toBe("2026-10-23T00:00:00.000Z");
  });
  it("average reply time from the stored timings, ignoring junk", () => {
    expect(averageReplyMs([{ timing: { total: 2000 } }, { timing: { total: 3000 } }, { timing: {} }, null, { timing: { total: "x" } }, { timing: { total: 99_999_999 } }])).toBe(2500);
    expect(averageReplyMs([])).toBeNull();
    expect(secondsLabel(2450)).toBe("2.5");
    expect(secondsLabel(65_000)).toBe("65");
    expect(secondsLabel(null)).toBeNull();
  });
});

describe("platform setup wizard", () => {
  it("lists missing variables and the addresses to paste, never secret values", () => {
    const env = { WA_BRIDGE_URL: "https://bridge.up.railway.app", WA_BRIDGE_SECRET: "x".repeat(30), META_APP_ID: "123456789", META_APP_SECRET: "s3cr3t-value-very-long" };
    const steps = setupSteps(env, "https://app.example.com/");
    expect(steps.map((s) => s.key)).toEqual(["bridge", "meta_app", "wa_official", "meta_pages", "google", "shopify"]);
    expect(steps.find((s) => s.key === "bridge")!.done).toBe(true);
    expect(steps.find((s) => s.key === "meta_app")!.done).toBe(true);
    const wa = steps.find((s) => s.key === "wa_official")!;
    expect(wa.done).toBe(false);
    expect(wa.vars.filter((v) => !v.set).map((v) => v.name)).toEqual(["META_WA_CONFIG_ID", "META_WEBHOOK_VERIFY_TOKEN"]);
    expect(wa.copies[0]!.value).toBe("https://app.example.com/api/channels/meta/whatsapp");
    expect(steps.find((s) => s.key === "google")!.copies.map((c) => c.value)).toEqual(["https://app.example.com/api/google/callback", "https://app.example.com/api/oauth/google/callback"]);
    expect(JSON.stringify(steps)).not.toContain("s3cr3t");
    expect(JSON.stringify(steps)).not.toContain("x".repeat(30));
    expect(setupProgress(steps)).toEqual({ done: 2, total: 6, pct: 33 });
  });
  it("a too-short bridge secret is not 'done'", () => {
    const s = setupSteps({ WA_BRIDGE_URL: "https://b", WA_BRIDGE_SECRET: "short" }, "https://a");
    expect(s[0]!.done).toBe(false);
  });
});
