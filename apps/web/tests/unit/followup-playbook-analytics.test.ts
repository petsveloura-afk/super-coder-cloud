import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOLLOWUP_HONESTY, convertedReason, followupPolicy, followupStage, localMinutes, nightWaitMinutes, playbookInstruction } from "@/lib/ai/followup-playbook";
import { handlingStats, resolutionStats } from "@/lib/ai/resolution-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("follow-up playbook — a job per follow-up, always honest", () => {
  it("stages: nudge → new angle → respectful close (a single follow-up stays a nudge)", () => {
    expect(followupStage(1, 1)).toBe("nudge");
    expect(followupStage(1, 3)).toBe("nudge");
    expect(followupStage(2, 3)).toBe("angle");
    expect(followupStage(3, 3)).toBe("close");
    expect(followupStage(2, 2)).toBe("close");
    expect(followupStage(9, 3)).toBe("close");
    expect(followupStage(0, 0)).toBe("nudge");
  });

  it("every instruction carries the honesty rules: no invented scarcity, deadlines, discounts or guilt", () => {
    for (const [s, m] of [[1, 3], [2, 3], [3, 3]] as const) {
      const p = playbookInstruction(s, m);
      expect(p).toContain(FOLLOWUP_HONESTY);
      expect(p).toMatch(/NEVER invent scarcity, urgency, deadlines, discounts/);
    }
    expect(playbookInstruction(3, 3)).toMatch(/closing the loop/);
    expect(playbookInstruction(2, 3)).toMatch(/NEW angle/);
    expect(playbookInstruction(1, 3)).toMatch(/one-tap question/);
  });

  it("night window in the business time zone (only when no quiet hours were set)", () => {
    // 22:00 in Israel (winter, UTC+2) = 20:00 UTC → wait until 08:30 = 630 minutes
    const night = new Date("2026-11-06T20:00:00Z");
    expect(localMinutes(night, "Asia/Jerusalem")).toBe(22 * 60);
    expect(nightWaitMinutes({ now: night, tz: "Asia/Jerusalem" })).toBe(630);
    // 06:00 local → 150 minutes
    expect(nightWaitMinutes({ now: new Date("2026-11-06T04:00:00Z"), tz: "Asia/Jerusalem" })).toBe(150);
    // daytime → send now
    expect(nightWaitMinutes({ now: new Date("2026-11-06T10:00:00Z"), tz: "Asia/Jerusalem" })).toBe(0);
    // the business set its own quiet hours (the database guard enforces them) or turned the guard off → no extra wait
    expect(nightWaitMinutes({ now: night, tz: "Asia/Jerusalem", quietStart: "23:00", quietEnd: "07:00" })).toBe(0);
    expect(nightWaitMinutes({ now: night, tz: "Asia/Jerusalem", nightGuard: false })).toBe(0);
    // a broken time zone falls back to Israel time instead of crashing
    expect(localMinutes(night, "Not/AZone")).toBe(22 * 60);
  });

  it("a customer who booked or bought gets no more sales follow-ups", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    expect(convertedReason({ upcomingAppointments: ["2026-11-08T09:00:00Z"], wonDeals: [] }, now)).toBe("booked");
    expect(convertedReason({ upcomingAppointments: [], wonDeals: ["2026-10-20T09:00:00Z"] }, now)).toBe("bought");
    expect(convertedReason({ upcomingAppointments: ["2026-10-01T09:00:00Z"], wonDeals: ["2026-08-01T00:00:00Z", null] }, now)).toBeNull();
  });

  it("policy defaults match the database (playbook, stop-on-convert and night guard on; cross-channel off)", () => {
    expect(followupPolicy(null)).toMatchObject({ max: 1, playbook: true, stopOnConvert: true, nightGuard: true, crossChannel: false });
    expect(followupPolicy({ followup_max: 9, followup_cross_channel: true, followup_playbook: false })).toMatchObject({ max: 5, crossChannel: true, playbook: false });
  });

  it("wiring: the scheduler holds / cancels / moves follow-ups, the agent uses the playbook, settings and migration", () => {
    const sch = read("lib/conversations/scheduler.ts");
    for (const k of ['p_reason: "quiet_hours"', "ex.postpone(s.id, wait)", "converted_${why}", "cross_channel:${target.channel}", 'g.reason === "outside_24h"']) expect(sch, k).toContain(k);
    // the database guard is still asked first, for every item
    expect(sch.indexOf("checkGuard(s.conversation_id, KIND[s.kind], s.id)")).toBeLessThan(sch.indexOf("followup-extras"));
    const f = read("lib/ai/followups.ts");
    expect(f).toContain("playbookInstruction(step, opts.max)");
    expect(f).toContain("FOLLOWUP_HONESTY,");
    // the previous instructions are kept for the playbook-off path
    expect(f).toContain("Write ONE very short, friendly last check-in");
    const mig = read("../../supabase/migrations/20261106000002_followup_playbook.sql");
    for (const k of ["'followup_max', 1", "'opt_out_reply', true", "'followup_playbook', true", "'followup_cross_channel', false", "has_permission(p_org, 'settings.manage')"]) expect(mig, k).toContain(k);
    expect(read("app/[locale]/(dashboard)/settings/policy-actions.ts")).toContain('followup_cross_channel: fd.get("followup_cross_channel") === "on"');
    expect(read("components/settings/team-plus.tsx")).toContain('data-testid="followup-playbook"');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of ["title", "hint", "followup_playbook", "followup_playbook_hint", "followup_stop_on_convert", "followup_night_guard", "followup_cross_channel", "followup_cross_channel_hint"]) expect(typeof d.guard.playbook[k], `${l}.${k}`).toBe("string");
    }
  });
});

describe("analytics — synced and honest numbers", () => {
  const m = (c: string, dir: string, body: string, i: number, ag: string | null = null) => ({ conversationId: c, direction: dir, body, aiAgentId: ag, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  it("agent quality counts conversations the agent handled alone even while they stay open (was 0% unless closed)", () => {
    const convs = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, status: id === "a" ? "closed" : "open" }));
    const msgs = [
      ...["a", "b", "c", "d", "e"].flatMap((id) => [m(id, "in", "היי", 0), m(id, "out", "שלום", 1, "ag")]),
      m("e", "out", "נציג כאן", 2),
      m("f", "in", "היי", 0),
    ];
    const s = handlingStats(convs, msgs);
    expect(s.aiConversations).toBe(5);
    expect(s.handledAlone).toBe(4);
    expect(s.handledAloneRate).toBe(80);
    expect(s.handedOver).toBe(1);
    expect(s.handedOverRate).toBe(20);
    expect(resolutionStats(convs, msgs).closedRate).toBe(20); // unchanged meaning
  });

  it("the analytics page: period first, open deals without amount are flagged, money collected comes from finance", () => {
    const p = read("app/[locale]/(dashboard)/analytics/page.tsx");
    expect(p.indexOf('data-testid="analytics-period"')).toBeLessThan(p.indexOf("<ExportCsvButton"));
    expect(p).toContain('.eq("status", "open").eq("value", 0)');
    expect(p).toContain('supabase.from("payments").select("amount, paid_at")');
    expect(p).toContain('data-testid="analytics-novalue"');
    const q = read("components/analytics/quality-section.tsx");
    expect(q).toContain('data-testid="quality-alone"');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of ["collected", "collectedSub", "noValueShort", "noValueTitle", "noValueHint"]) expect(typeof d.analytics.sync[k], `${l}.${k}`).toBe("string");
      for (const k of ["handledAlone", "handedOver", "count", "closedHint", "lowerBetter"]) expect(typeof d.aiQuality.card[k], `${l}.${k}`).toBe("string");
    }
  });
});
