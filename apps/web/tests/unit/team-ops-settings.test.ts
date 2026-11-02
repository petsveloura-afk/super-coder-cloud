import { describe, expect, it } from "vitest";
import { cleanOps, DEFAULT_OPS, digestsDue, localParts, sendsShouldWait } from "@/lib/team/ops-settings-core";
import { isAutomatedSenderPlus } from "@/lib/team/safety-plus-core";
import { isAutomatedSender } from "@/lib/team/safety-core";

describe("operations settings (upgrade 3)", () => {
  it("anything missing or invalid becomes the safe default", () => {
    expect(cleanOps(undefined)).toEqual(DEFAULT_OPS);
    expect(cleanOps("junk")).toEqual(DEFAULT_OPS);
    expect(cleanOps({ quiet: { enabled: "yes", start: 99 }, sla: { targetMin: -5 }, protect: { recipientCap: 0 } })).toEqual(DEFAULT_OPS);
    expect(DEFAULT_OPS.quiet.enabled).toBe(false);
  });
  it("valid values are kept and clamped", () => {
    const o = cleanOps({ quiet: { enabled: true, start: 21, end: 6 }, sla: { targetMin: 30 }, digest: { daily: false }, dedupe: false, protect: { rateLimits: false, recipientCap: 3 } });
    expect(o.quiet).toEqual({ enabled: true, start: 21, end: 6 });
    expect(o.sla.targetMin).toBe(30);
    expect(o.digest).toEqual({ daily: false, weekly: true });
    expect(o.dedupe).toBe(false);
    expect(o.protect).toEqual({ rateLimits: false, anomalyFreeze: true, recipientCap: 3 });
  });
  it("the morning digest is due from 07:00 local, once per day; the weekly one only on Sunday", () => {
    const sundayMorning = Date.parse("2026-11-01T06:30:00Z"); // 08:30 in Jerusalem (UTC+2), a Sunday
    const p = localParts(sundayMorning, "Asia/Jerusalem");
    expect(p.weekday).toBe(0);
    const due = digestsDue(sundayMorning, "Asia/Jerusalem", DEFAULT_OPS, new Set());
    expect(due.map((d) => d.period).sort()).toEqual(["day", "week"]);
    expect(digestsDue(sundayMorning, "Asia/Jerusalem", DEFAULT_OPS, new Set(due.map((d) => d.key)))).toEqual([]);
    expect(digestsDue(Date.parse("2026-11-01T03:00:00Z"), "Asia/Jerusalem", DEFAULT_OPS, new Set())).toEqual([]); // 05:00 local
    const monday = Date.parse("2026-11-02T08:00:00Z");
    expect(digestsDue(monday, "Asia/Jerusalem", DEFAULT_OPS, new Set()).map((d) => d.period)).toEqual(["day"]);
    expect(digestsDue(monday, "Asia/Jerusalem", cleanOps({ digest: { daily: false } }), new Set())).toEqual([]);
  });
  it("quiet hours hold customer sends only when the owner turned them on", () => {
    const on = cleanOps({ quiet: { enabled: true } });
    expect(sendsShouldWait(true, on, true)).toBe(true);
    expect(sendsShouldWait(true, on, false)).toBe(false);
    expect(sendsShouldWait(true, DEFAULT_OPS, true)).toBe(false);
    expect(sendsShouldWait(false, on, true)).toBe(false);
  });
});

describe("isAutomatedSenderPlus", () => {
  it("keeps everything the original catches and adds robots / out-of-office replies", () => {
    for (const e of ["noreply@x.com", "notifications@github.com", "billing-noreply@vendor.com"]) {
      expect(isAutomatedSender({ email: e })).toBe(true);
      expect(isAutomatedSenderPlus({ email: e })).toBe(true);
    }
    expect(isAutomatedSenderPlus({ email: "mailer-daemon@mail.example.com" })).toBe(true);
    expect(isAutomatedSenderPlus({ email: "no_reply@shop.co.il" })).toBe(true);
    expect(isAutomatedSenderPlus({ email: "noreply123@shop.co.il" })).toBe(true);
    expect(isAutomatedSenderPlus({ email: "dana@gmail.com", name: "תשובה אוטומטית: מחוץ למשרד" })).toBe(true);
    expect(isAutomatedSenderPlus({ email: "dana@shop.co.il", subject: "Out of office until Monday" })).toBe(true);
  });
  it("real people and role mailboxes are never robots", () => {
    for (const e of ["info@shop.co.il", "support@shop.co.il", "sales@shop.co.il", "dana.levi@gmail.com", "office@clinic.co.il"]) expect(isAutomatedSenderPlus({ email: e, name: "Dana Levi" })).toBe(false);
  });
});
