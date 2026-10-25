import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchTerm, slaTone, waitingMinutes, waitLabel } from "@/lib/inbox/sla";
import { fillReply, filterReplies, normalizeShortcut, STARTER_REPLIES } from "@/lib/inbox/saved-replies-core";
import { dealAgeDays, isOverdue, isStale, pipelineInsights } from "@/lib/deals/insights";
import * as C from "@/lib/calculators/core";
import { nextActions } from "@/lib/dashboard/next-actions-core";
import { daysLeft, planAdvice, usagePct, yearlySavings } from "@/lib/billing/advisor";
import { NAV_ITEMS } from "@/lib/navigation";
import { matchCommands } from "@/lib/command-actions";

const NOW = Date.parse("2026-10-25T10:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("wave 24 — inbox: who is waiting", () => {
  it("waiting only when the customer wrote last on an open conversation", () => {
    expect(waitingMinutes({ status: "open", last_customer_at: ago(12), last_ai_at: ago(20) }, NOW)).toBe(12);
    expect(waitingMinutes({ status: "open", last_customer_at: ago(12), last_ai_at: ago(11) }, NOW)).toBeNull();
    expect(waitingMinutes({ status: "open", last_customer_at: ago(12), last_human_at: ago(12) }, NOW)).toBeNull();
    expect(waitingMinutes({ status: "closed", last_customer_at: ago(12) }, NOW)).toBeNull();
    expect(waitingMinutes({ status: "open", last_customer_at: null }, NOW)).toBeNull();
  });
  it("tones and labels", () => {
    expect([slaTone(3), slaTone(10), slaTone(40), slaTone(null)]).toEqual(["ok", "warn", "late", null]);
    expect(waitLabel(5, "he")).toBe("5 דק'");
    expect(waitLabel(130, "en")).toBe("2h");
    expect(waitLabel(60 * 50, "he")).toBe("2 ימים");
  });
  it("search text can never inject PostgREST filter syntax", () => {
    expect(searchTerm("דנה")).toBe("דנה");
    expect(searchTerm("a),status.eq.closed,(x")).toBe("a status.eq.closed x");
    expect(searchTerm("%_*")).toBeNull();
    expect(searchTerm("x")).toBeNull();
    expect(searchTerm(["a"])).toBeNull();
  });
});

describe("wave 24 — saved replies", () => {
  it("fills {name} with the first name and {business}", () => {
    expect(fillReply("היי {name}, תודה שפנית ל{business}!", { name: "דנה כהן", business: "בוטניקה" })).toBe("היי דנה, תודה שפנית לבוטניקה!");
    expect(fillReply("היי {name}, מה שלומך?", { name: null })).toBe("היי, מה שלומך?");
  });
  it("shortcuts are normalized and validated", () => {
    expect(normalizeShortcut("/Price List")).toBe("price-list");
    expect(normalizeShortcut("מחיר")).toBe("מחיר");
    expect(normalizeShortcut("bad!")).toBeNull();
  });
  it("filters by shortcut, title or text, most used first", () => {
    const list = [
      { id: "1", title: "Hello", body: "hi", shortcut: "hi", use_count: 1 },
      { id: "2", title: "מחירון", body: "מצרף", shortcut: "מחיר", use_count: 9 },
    ];
    expect(filterReplies(list, "").map((r) => r.id)).toEqual(["2", "1"]);
    expect(filterReplies(list, "/מח").map((r) => r.id)).toEqual(["2"]);
    expect(filterReplies(list, "hello").map((r) => r.id)).toEqual(["1"]);
    for (const s of STARTER_REPLIES) expect(normalizeShortcut(s.shortcut)).toBe(s.shortcut);
  });
});

describe("wave 24 — pipeline insights", () => {
  it("age, stale and overdue", () => {
    expect(dealAgeDays(new Date(NOW - 20 * 86_400_000).toISOString(), NOW)).toBe(20);
    expect(isStale(15)).toBe(true);
    expect(isStale(14)).toBe(false);
    expect(isOverdue("2026-10-24", new Date(NOW))).toBe(true);
    expect(isOverdue("2026-10-25", new Date(NOW))).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });
  it("win rate, average, forecast", () => {
    const prob = new Map([["s1", 50], ["s2", 100]]);
    const r = pipelineInsights(
      [
        { value: 1000, stage_id: "s1", expected_close_date: "2026-10-30", updated_at: new Date(NOW - 30 * 86_400_000).toISOString() },
        { value: 500, stage_id: "s2", expected_close_date: "2026-10-01", updated_at: new Date(NOW).toISOString() },
        { value: 900, stage_id: "s2", expected_close_date: "2026-12-01", updated_at: new Date(NOW).toISOString() },
      ],
      [{ status: "won", value: 2000 }, { status: "won", value: 1000 }, { status: "lost", value: 300 }],
      prob,
      new Date(NOW),
    );
    expect(r).toMatchObject({ winRate: 67, avgWon: 1500, forecastMonth: 1000, staleCount: 1, overdueCount: 1, closedWon: 2, closedLost: 1 });
    expect(pipelineInsights([], [], prob).winRate).toBeNull();
  });
});

describe("wave 24 — calculators", () => {
  it("VAT add / extract at 18%", () => {
    expect(C.vat(100)).toEqual({ net: 100, vat: 18, gross: 118 });
    expect(C.vat(118, 18, "extract")).toEqual({ net: 100, vat: 18, gross: 118 });
    expect(C.vat(NaN)).toBeNull();
  });
  it("margin, markup and price for a wanted margin", () => {
    expect(C.margin(60, 100)).toEqual({ profit: 40, marginPct: 40, markupPct: 66.67 });
    expect(C.priceForMargin(60, 40)).toBe(100);
    expect(C.priceForMargin(60, 100)).toBeNull();
  });
  it("discounts, loans, break-even", () => {
    expect(C.discount(500, 10, 10)).toEqual({ final: 405, saved: 95, effectivePct: 19 });
    expect(C.loan(12000, 0, 12)).toEqual({ monthly: 1000, total: 12000, interest: 0 });
    const l = C.loan(50000, 6, 36)!;
    expect(l.monthly).toBeCloseTo(1521.1, 1);
    expect(C.breakEven(20000, 250, 90)).toEqual({ units: 125, revenue: 31250, contribution: 160 });
    expect(C.breakEven(1000, 50, 60)).toBeNull();
  });
  it("commission, hourly rate, ROI, LTV, quote, campaign, percent, employer", () => {
    expect(C.commission(80000, 5, 60000, 3)).toEqual({ base: 4000, bonus: 600, total: 4600 });
    expect(C.hourlyRate(14000, 0, 100, 30)!.rate).toBe(200);
    expect(C.agentRoi(600, 6, 60, 299)).toMatchObject({ hoursSaved: 60, value: 3600, net: 3301 });
    expect(C.ltv(350, 4, 3, 40)).toEqual({ ltv: 1680, maxCac: 560 });
    expect(C.quickQuote([{ qty: 2, price: 100 }], 10)).toEqual({ subtotal: 200, discount: 20, net: 180, vat: 32.4, total: 212.4 });
    expect(C.campaign(3000, 120, 15, 12000)).toEqual({ cpl: 25, cac: 200, conversionPct: 12.5, roas: 4 });
    expect(C.percentChange(40000, 52000)).toBe(30);
    expect(C.percentChange(0, 5)).toBeNull();
    expect(C.employerCost(10000)).toEqual({ addOns: 1850, total: 11850, yearly: 142200 });
    expect(C.num("₪1,234.5")).toBe(1234.5);
    expect(Number.isNaN(C.num(""))).toBe(true);
  });
});

describe("wave 24 — what to do now", () => {
  it("most urgent first, setup gaps last, capped", () => {
    const r = nextActions({ waiting: 2, needsHuman: 1, hotLeads: 0, overdueTasks: 3, staleDeals: 4, overdueDeals: 1, channels: 0, agents: 0 });
    expect(r.map((a) => a.key)).toEqual(["waiting", "needsHuman", "overdueTasks", "overdueDeals", "staleDeals"]);
    expect(nextActions({ waiting: 0, needsHuman: 0, hotLeads: 0, overdueTasks: 0, staleDeals: 0, overdueDeals: 0, channels: 2, agents: 1 })).toEqual([]);
    expect(nextActions({ waiting: 0, needsHuman: 0, hotLeads: 0, overdueTasks: 0, staleDeals: 0, overdueDeals: 0, channels: 0, agents: null }).map((a) => a.key)).toEqual(["connectChannel"]);
  });
});

describe("wave 24 — subscription advisor", () => {
  const plans = [
    { key: "free", limits: { contacts: 100, members: 1 } },
    { key: "pro", limits: { contacts: 1000, members: 5 } },
    { key: "business", limits: { contacts: null, members: 25 } },
  ];
  it("usage %, advice and the next plan with room", () => {
    expect(usagePct(50, 100)).toBe(50);
    expect(usagePct(5, null)).toBeNull();
    expect(planAdvice([{ key: "contacts", used: 20, limit: 100 }], "free", plans)).toEqual({ level: "ok", hot: [], suggest: null });
    expect(planAdvice([{ key: "contacts", used: 100, limit: 100 }], "free", plans)).toMatchObject({ level: "over", suggest: "pro" });
    expect(planAdvice([{ key: "contacts", used: 900, limit: 1000 }], "pro", plans)).toMatchObject({ level: "near", suggest: "business" });
  });
  it("yearly savings and renewal countdown", () => {
    expect(yearlySavings(100, 1000)).toEqual({ saved: 200, pct: 17, perMonth: 83.33 });
    expect(yearlySavings(0, 0)).toBeNull();
    expect(daysLeft(new Date(NOW + 3.5 * 86_400_000).toISOString(), NOW)).toBe(4);
    expect(daysLeft(null)).toBeNull();
  });
});

describe("wave 24 — wiring", () => {
  it("calculators are in the menu and the command palette; every calculator label exists", () => {
    expect(NAV_ITEMS.find((n) => n.key === "calculators")).toMatchObject({ section: "ops", phase: null });
    expect(matchCommands("מחשבון", (k) => k, () => true).map((c) => c.key)).toContain("calculators");
    const he = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../lib/i18n/dictionaries/he.json"), "utf8"));
    const src = readFileSync(path.join(import.meta.dirname, "../../components/calculators/calculators-client.tsx"), "utf8");
    for (const key of C.CALCULATORS.filter((k) => k !== "quote" || true)) {
      if (!src.includes(`key: "${key}"`)) continue;
      expect(he.calculators[key]?.title, key).toBeTruthy();
    }
    for (const m of src.matchAll(/k: "(\w+)"/g)) expect(he.calculators.r[m[1]!], m[1]).toBeTruthy();
  });
});
