/**
 * Wave 24 — "what to do now" (pure, unit-tested): turns a few counts into a short, ordered to-do
 * list for the business owner. Most urgent first; at most `max` items; nothing when all is calm.
 */
export interface NextActionCounts {
  waiting: number; // customers waiting for an answer
  needsHuman: number; // conversations the agent handed to a person
  hotLeads: number; // open hot leads
  overdueTasks: number;
  staleDeals: number; // open deals unchanged 14+ days
  overdueDeals: number; // open deals past the expected close date
  channels: number | null; // null = not allowed to see
  agents: number | null;
}

export type NextActionKey = "waiting" | "needsHuman" | "hotLeads" | "overdueTasks" | "overdueDeals" | "staleDeals" | "connectChannel" | "createAgent";
export interface NextAction {
  key: NextActionKey;
  count: number;
  href: string; // relative to /{locale}
  tone: "danger" | "warning" | "accent";
}

export function nextActions(c: NextActionCounts, max = 5): NextAction[] {
  const out: NextAction[] = [];
  const push = (key: NextActionKey, count: number, href: string, tone: NextAction["tone"]) => count > 0 && out.push({ key, count, href, tone });
  push("waiting", c.waiting, "/inbox?fl=waiting", "danger");
  push("needsHuman", c.needsHuman, "/inbox?fl=human", "danger");
  push("hotLeads", c.hotLeads, "/inbox?fl=hot", "warning");
  push("overdueTasks", c.overdueTasks, "/tasks", "warning");
  push("overdueDeals", c.overdueDeals, "/pipelines?fl=overdue", "warning");
  push("staleDeals", c.staleDeals, "/pipelines?fl=stale", "accent");
  if (c.channels === 0) out.push({ key: "connectChannel", count: 1, href: "/integrations", tone: "accent" });
  if (c.agents === 0) out.push({ key: "createAgent", count: 1, href: "/ai-agents", tone: "accent" });
  return out.slice(0, max);
}
