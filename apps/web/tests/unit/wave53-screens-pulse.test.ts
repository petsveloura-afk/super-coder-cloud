import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyticsPulse, appointmentsPulse, campaignsPulse, contactsPulse, financePulse, formsPulse, sitesPulse, supportPulse } from "@/lib/insights/screens-core";
import he from "@/lib/i18n/dictionaries/he.json";

const keysOf = (p: { stats: { key: string }[]; tips: { key: string }[] }) => ({ s: p.stats.map((x) => x.key), t: p.tips.map((x) => x.key) });
const dict = he as unknown as { pulse: Record<string, { stat?: Record<string, string>; tip: Record<string, string> }> };

describe("wave 53 — smart pulse per screen", () => {
  it("contacts", () => {
    const p = contactsPulse({ total: 100, newWeek: 0, customers: 12, hot: 3, noChannel: 4 });
    expect(keysOf(p).t).toEqual(["callHot", "enrich", "noNew"]);
    expect(contactsPulse({ total: 0, newWeek: 0, customers: 0, hot: 0, noChannel: 0 }).tips.map((x) => x.key)).toContain("first");
  });
  it("campaigns", () => {
    expect(campaignsPulse({ total: 0, drafts: 0, active: 0, sent: 0, failed: 0, deliveryRate: 0 }).tips[0]!.key).toBe("first");
    expect(campaignsPulse({ total: 5, drafts: 2, active: 0, sent: 80, failed: 20, deliveryRate: 0.8 }).tips.map((x) => x.key)).toEqual(["drafts", "delivery"]);
  });
  it("sites, forms", () => {
    expect(sitesPulse([{ status: "published", visits: 0 }, { status: "draft", visits: 0 }]).tips.map((x) => x.key)).toEqual(["publish", "share"]);
    const f = formsPulse([{ status: "active", submission_count: 0, name: "A" }, { status: "active", submission_count: 7, name: "B" }], 2);
    expect(f.stats.find((x) => x.key === "total")!.value).toBe(7);
    expect(f.tips.map((x) => x.key)).toEqual(["idle", "best", "automate"]);
  });
  it("appointments: no-show rate", () => {
    const a = appointmentsPulse({ today: 2, week: 5, upcoming: 9, noShows30: 2, held30: 8, types: 1 });
    expect(a.stats.find((x) => x.key === "noShow")!.value).toBe(20);
    expect(a.tips.map((x) => x.key)).toEqual(["noShow", "today"]);
  });
  it("analytics: pace and coverage", () => {
    const a = analyticsPulse({ wonValue: 9000, prevWonValue: 6000, days: 90, openValue: 50000, weightedValue: 6000 });
    expect(a.stats[0]!.value).toBe(3000);
    expect(a.tips.map((x) => x.key)).toEqual(["up", "coverageOk"]);
  });
  it("support: SLA and first reply", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const s = supportPulse([{ status: "open", priority: "urgent", sla_due_at: "2026-10-29T10:00:00Z", first_response_at: null }, { status: "resolved", priority: "low", sla_due_at: null, first_response_at: null }], now);
    expect(s.stats.map((x) => x.value)).toEqual([1, 1, 1, 1]);
    expect(supportPulse([], now).tips[0]!.key).toBe("clear");
  });
  it("finance: overdue, due soon, quotes", () => {
    const f = financePulse(
      [
        { kind: "invoice", status: "sent", due_date: "2026-10-01", total: 1000, amount_paid: 200 },
        { kind: "invoice", status: "sent", due_date: "2026-11-02", total: 500, amount_paid: 0 },
        { kind: "quote", status: "sent", due_date: null, total: 900, amount_paid: 0 },
      ],
      "2026-10-29",
    );
    const v = Object.fromEntries(f.stats.map((x) => [x.key, x.value]));
    expect(v).toEqual({ outstanding: 1300, overdue: 800, dueSoon: 500, quotes: 1 });
  });
  it("every stat / tip key has a Hebrew text", () => {
    const all = {
      contacts: contactsPulse({ total: 0, newWeek: 0, customers: 9, hot: 1, noChannel: 1 }),
      campaigns: campaignsPulse({ total: 3, drafts: 1, active: 0, sent: 30, failed: 10, deliveryRate: 0.75 }),
      sites: sitesPulse([{ status: "published", visits: 3 }]),
      forms: formsPulse([], 0),
      appointments: appointmentsPulse({ today: 1, week: 1, upcoming: 0, noShows30: 5, held30: 5, types: 0 }),
      analytics: analyticsPulse({ wonValue: 0, prevWonValue: 0, days: 30, openValue: 10, weightedValue: 0 }),
      support: supportPulse([], new Date()),
      finance: financePulse([], "2026-10-29"),
    };
    for (const [screen, p] of Object.entries(all)) {
      for (const s of p.stats) expect(dict.pulse[screen]?.stat?.[s.key], `${screen}.stat.${s.key}`).toBeTruthy();
      for (const t of p.tips) expect(dict.pulse[screen]?.tip?.[t.key], `${screen}.tip.${t.key}`).toBeTruthy();
    }
  });
  it("motion CSS respects reduced motion", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    const tail = css.slice(css.indexOf("Wave 53"));
    expect(tail).toMatch(/prefers-reduced-motion: reduce/);
    expect(tail).not.toMatch(/@keyframes pulse-rise[^}]*opacity/);
  });
});
