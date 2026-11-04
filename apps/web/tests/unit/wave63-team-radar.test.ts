import { describe, expect, it } from "vitest";
import { EMPTY_RADAR, radarDigest, radarFindings, radarProposals, type RadarInput } from "@/lib/team/business-radar-core";
import { initiatives } from "@/lib/team/insight-core";
import { gateOutbound } from "@/lib/team/output-gate-core";
import { guardOutbound } from "@/lib/team/plus8b-hooks";

const input = (p: Partial<RadarInput>): RadarInput => ({ ...EMPTY_RADAR, ...p });
const day = "2026-11-04";

describe("wave 63 — business radar", () => {
  it("a calm business has no findings", () => {
    expect(radarFindings(EMPTY_RADAR, day)).toEqual([]);
  });
  it("hot leads waiting come first, and money is named", () => {
    const f = radarFindings(input({ hotLeadsWaiting: { count: 2, oldestHours: 5 }, overdueDebts: { count: 3, amount: 12400, currency: "ILS", maxDaysLate: 20 }, dormantDeals: { count: 4, amount: 30000, currency: "ILS", oldestDays: 15 } }), day);
    expect(f[0]!.topic).toBe("hot");
    const debts = f.find((x) => x.topic === "invoices")!;
    expect(debts.proposal.title).toContain("12,400");
    expect(debts.rank).toBe(1); // 20 days late is urgent
    expect(f.find((x) => x.topic === "deals")!.proposal.title).toContain("30,000");
  });
  it("a drop or a surge needs a real base", () => {
    expect(radarFindings(input({ leadsYesterday: 0, leadsAvg: 1, leadsAvgDays: 7 }), day)).toEqual([]);
    expect(radarFindings(input({ leadsYesterday: 1, leadsAvg: 8, leadsAvgDays: 3 }), day)).toEqual([]);
    expect(radarFindings(input({ leadsYesterday: 2, leadsAvg: 8, leadsAvgDays: 7 }), day).map((x) => x.topic)).toEqual(["drop"]);
    const surge = radarFindings(input({ leadsYesterday: 14, leadsAvg: 5, leadsAvgDays: 7 }), day);
    expect(surge.map((x) => x.topic)).toEqual(["surge"]);
    expect(surge[0]!.kind).toBe("opportunity");
  });
  it("customers waiting a long time: 12 hours is urgent", () => {
    const f = radarFindings(input({ longWaiting: { count: 3, oldestHours: 13 } }), day)[0]!;
    expect(f.proposal.priority).toBe(1);
  });
  it("does not create what the existing initiatives already cover, and creates at most 3", () => {
    const sig = { newLeadsUncontacted: 0, negativeReviewsOpen: 0, unansweredConversations: 2, stuckDeals: 3, overdueInvoices: 1, leadsYesterday: 0, leadsAvg: 0, daysSinceLastPost: null };
    const existing = initiatives(sig, day);
    const findings = radarFindings(input({ hotLeadsWaiting: { count: 1, oldestHours: 2 }, longWaiting: { count: 2, oldestHours: 6 }, dormantDeals: { count: 3, amount: 9000, currency: "ILS", oldestDays: 9 }, overdueDebts: { count: 1, amount: 500, currency: "ILS", maxDaysLate: 3 }, leadsYesterday: 20, leadsAvg: 4, leadsAvgDays: 7 }), day);
    const extra = radarProposals(findings, existing, 3);
    const keys = extra.map((p) => p.key.split(":")[0]);
    expect(keys).toEqual(["radar-hot", "radar-surge"]);
    expect(radarProposals(findings, [], 2)).toHaveLength(2);
  });
  it("every proposal has a role, a title and a brief that forbids inventing", () => {
    for (const f of radarFindings(input({ hotLeadsWaiting: { count: 1, oldestHours: 2 }, overdueDebts: { count: 1, amount: 800, currency: "USD", maxDaysLate: 9 } }), day)) {
      expect(f.proposal.role).toBeTruthy();
      expect(f.proposal.title.length).toBeGreaterThan(5);
      expect(f.proposal.brief.length).toBeGreaterThan(40);
    }
    expect(radarFindings(input({ overdueDebts: { count: 1, amount: 800, currency: "USD", maxDaysLate: 9 } }), day)[0]!.proposal.title).toContain("USD");
    expect(radarDigest(radarFindings(input({ hotLeadsWaiting: { count: 1, oldestHours: 2 } }), day))[0]).toMatch(/^💡/);
  });
});

describe("wave 63 — outbound quality gate", () => {
  it("holds a message with an unfilled placeholder", () => {
    for (const t of ["שלום [שם הלקוח], ההצעה מצורפת", "Hi {{first_name}}, your quote", "Dear [Customer Name]", "היי <name>"]) {
      const g = gateOutbound(t);
      expect(g.ok).toBe(false);
      expect(g.reasons).toContain("placeholder");
    }
  });
  it("removes a leaked control line and still sends the real message", () => {
    const g = gateOutbound("שלום דנה, התור נקבע ליום ראשון.\n[[TASK: להתקשר ללקוחה | due=1d]]");
    expect(g.ok).toBe(true);
    expect(g.text).toBe("שלום דנה, התור נקבע ליום ראשון.");
    expect(g.reasons).toContain("control_line");
  });
  it("holds raw JSON and unfinished drafts, and an empty text", () => {
    expect(gateOutbound('{"subject":"hi","body":"x"}').ok).toBe(false);
    expect(gateOutbound("טיוטה: שלום דנה, רציתי לעדכן").ok).toBe(false);
    expect(gateOutbound("   ").ok).toBe(false);
  });
  it("lets a normal message through untouched", () => {
    const t = "שלום דנה, רציתי לעדכן שההזמנה יצאה. [1] תודה על הסבלנות!";
    expect(gateOutbound(t)).toEqual({ ok: true, text: t, reasons: [] });
  });
  it("is what the team's outbound hook uses", () => {
    expect(guardOutbound("שלום [שם הלקוח]").ok).toBe(false);
    expect(guardOutbound("שלום דנה").ok).toBe(true);
  });
});
