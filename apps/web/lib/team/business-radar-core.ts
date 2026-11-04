/**
 * Wave 63 — the business radar (pure, unit-tested). Looks at real numbers and finds the risks and the
 * opportunities a good manager would notice: hot leads waiting, a lead surge or drop, dormant deals
 * (with the money in them), overdue debts (with the money), customers waiting too long.
 * It returns tasks in the same `Proposal` shape as `initiatives` (insight-core) — the runner creates
 * them with the same rules (once a day per topic, "suggest only" members only propose).
 * Nothing here is invented: every finding carries the numbers it came from.
 */
import type { Proposal } from "./insight-core";

export interface RadarInput {
  /** hot leads whose last message from the customer is still unanswered */
  hotLeadsWaiting: { count: number; oldestHours: number };
  leadsYesterday: number;
  /** average daily leads over the recent past */
  leadsAvg: number;
  /** how many days the average is built from (a drop is only reported with a real base) */
  leadsAvgDays: number;
  dormantDeals: { count: number; amount: number; currency: string; oldestDays: number };
  overdueDebts: { count: number; amount: number; currency: string; maxDaysLate: number };
  /** customers whose message has waited more than 4 hours with no answer */
  longWaiting: { count: number; oldestHours: number };
}

export type RadarKind = "risk" | "opportunity";
/** the topics the existing initiatives already cover (insight-core keys) */
export type RadarTopic = "leads" | "inbox" | "deals" | "invoices" | "drop" | "surge" | "hot";

export interface RadarFinding {
  topic: RadarTopic;
  kind: RadarKind;
  proposal: Proposal;
  /** 1 = most urgent */
  rank: number;
}

const fmt = (n: number, cur: string) => `${Math.round(n).toLocaleString("en-US")} ${cur === "ILS" ? "₪" : cur}`;

export const EMPTY_RADAR: RadarInput = {
  hotLeadsWaiting: { count: 0, oldestHours: 0 },
  leadsYesterday: 0,
  leadsAvg: 0,
  leadsAvgDays: 0,
  dormantDeals: { count: 0, amount: 0, currency: "ILS", oldestDays: 0 },
  overdueDebts: { count: 0, amount: 0, currency: "ILS", maxDaysLate: 0 },
  longWaiting: { count: 0, oldestHours: 0 },
};

/** Risks and opportunities, most urgent first. */
export function radarFindings(i: RadarInput, day: string): RadarFinding[] {
  const out: RadarFinding[] = [];
  const add = (f: Omit<RadarFinding, "proposal"> & { proposal: Omit<Proposal, "key"> & { key?: string } }) => out.push({ ...f, proposal: { ...f.proposal, key: f.proposal.key ?? `radar-${f.topic}:${day}` } });

  if (i.hotLeadsWaiting.count > 0)
    add({
      topic: "hot",
      kind: "opportunity",
      rank: 1,
      proposal: {
        role: "sales",
        priority: 1,
        title: `${i.hotLeadsWaiting.count} hot lead(s) are waiting for a person (longest ${Math.max(1, Math.round(i.hotLeadsWaiting.oldestHours))}h)`,
        brief: "These are the customers most likely to buy and they wrote last. For each: read the conversation, write a short personal reply that answers their last message and moves to ONE next step (price confirmation, payment or an appointment). Draft for approval; start with the one waiting longest. Do not invent prices or discounts.",
      },
    });

  if (i.overdueDebts.count > 0)
    add({
      topic: "invoices",
      kind: "risk",
      rank: i.overdueDebts.maxDaysLate >= 14 ? 1 : 2,
      proposal: {
        role: "collections",
        priority: i.overdueDebts.maxDaysLate >= 14 ? 1 : 2,
        title: `${i.overdueDebts.count} overdue payment(s) — ${fmt(i.overdueDebts.amount, i.overdueDebts.currency)} (up to ${i.overdueDebts.maxDaysLate} days late)`,
        brief: `Overdue invoices total ${fmt(i.overdueDebts.amount, i.overdueDebts.currency)}. Start with the largest and the oldest. Prepare a polite, firm reminder with the payment link for approval; for 14+ days late, add a task for the owner to call. Do not threaten and do not add fees that are not in the agreement.`,
      },
    });

  if (i.dormantDeals.count > 0 && i.dormantDeals.amount > 0)
    add({
      topic: "deals",
      kind: "risk",
      rank: 2,
      proposal: {
        role: "sales",
        priority: 2,
        title: `${i.dormantDeals.count} dormant deal(s) worth ${fmt(i.dormantDeals.amount, i.dormantDeals.currency)}`,
        brief: `Open deals with no activity for 7+ days (the oldest: ${i.dormantDeals.oldestDays} days), ${fmt(i.dormantDeals.amount, i.dormantDeals.currency)} in total. Start with the biggest. For each decide: revive (one personal message that adds value, not "just checking in"), re-qualify, or close as lost with the reason. Create the follow-up drafts and tasks.`,
      },
    });

  if (i.longWaiting.count > 0)
    add({
      topic: "inbox",
      kind: "risk",
      rank: i.longWaiting.oldestHours >= 12 ? 1 : 2,
      proposal: {
        role: "customer_service",
        priority: i.longWaiting.oldestHours >= 12 ? 1 : 2,
        title: `${i.longWaiting.count} customer(s) waited over 4 hours (longest ${Math.round(i.longWaiting.oldestHours)}h)`,
        brief: "Customers are waiting more than 4 hours without a reply. Answer the longest-waiting first; start with a short apology for the wait, then the real answer. Escalate to a person anything about money, a complaint or a legal threat.",
      },
    });

  // a drop is only a signal with a real base (at least a week of data and ≥ 5 leads a day on average)
  if (i.leadsAvgDays >= 7 && i.leadsAvg >= 5 && i.leadsYesterday < i.leadsAvg * 0.5)
    add({
      topic: "drop",
      kind: "risk",
      rank: 2,
      proposal: {
        role: "analyst",
        priority: 2,
        title: `Leads dropped: ${i.leadsYesterday} yesterday vs ${Math.round(i.leadsAvg * 10) / 10} on average`,
        brief: `Yesterday ${i.leadsYesterday} leads against an average of ${Math.round(i.leadsAvg * 10) / 10} over ${i.leadsAvgDays} days. Check which source or channel fell (website, social, WhatsApp, forms), whether a connection broke, and what changed in the last 3 days. Separate facts from guesses and recommend 1-3 actions.`,
      },
    });

  if (i.leadsAvgDays >= 7 && i.leadsAvg >= 3 && i.leadsYesterday >= Math.max(6, i.leadsAvg * 2))
    add({
      topic: "surge",
      kind: "opportunity",
      rank: 2,
      proposal: {
        role: "sales",
        priority: 2,
        title: `Lead surge: ${i.leadsYesterday} yesterday vs ${Math.round(i.leadsAvg * 10) / 10} on average`,
        brief: `Leads are well above normal (${i.leadsYesterday} vs ${Math.round(i.leadsAvg * 10) / 10}). Find where they came from and make sure every one got a reply within minutes while the interest is high. Tell the owner what worked so it can be repeated.`,
      },
    });

  return out.sort((a, b) => a.rank - b.rank || a.proposal.priority - b.proposal.priority);
}

/** how existing initiative keys map to radar topics (so one topic is never created twice in a day) */
const COVERED_BY: Partial<Record<RadarTopic, string>> = { inbox: "inbox", deals: "deals", invoices: "invoices", drop: "drop", leads: "leads" };

/**
 * The radar's proposals that the existing initiatives do not already cover, at most `max` (default 3 a day).
 * `existing` are the proposals `initiatives()` produced for the same day.
 */
export function radarProposals(findings: RadarFinding[], existing: Proposal[], max = 3): Proposal[] {
  const taken = new Set(existing.map((p) => p.key.split(":")[0]));
  const out: Proposal[] = [];
  for (const f of findings) {
    const cover = COVERED_BY[f.topic];
    if (cover && taken.has(cover)) continue;
    out.push(f.proposal);
    if (out.length >= max) break;
  }
  return out;
}

/** Plain-language summary of the findings (for the weekly meeting / owner report). Empty when all is calm. */
export function radarDigest(findings: RadarFinding[]): string[] {
  return findings.map((f) => `${f.kind === "risk" ? "⚠️" : "💡"} ${f.proposal.title}`);
}
