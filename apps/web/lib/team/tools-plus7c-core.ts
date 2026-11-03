/**
 * Upgrade 7 / stages C–H — additional tools and role grants (pure data). Merged into the catalog by tools-core (TOOLS.push) and
 * into an employee's allowed tools by withRoleExtras7c (a SEPARATE function: withRoleExtras and withRoleExtras7 are unchanged).
 * Everything here is internal: nothing contacts a customer, spends money or is irreversible. Goals and experiments suggested by
 * an employee stay PROPOSED until the owner activates them.
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE7C_TOOLS: ToolSpec[] = [
  { key: "goals.list", kind: "read", sensitivity: "internal", permission: "ai.use", args: {}, about: "The business's goals with the measured value, the honest forecast (a range and a probability, or 'not enough data') and the risk status." },
  { key: "goals.forecast", kind: "read", sensitivity: "internal", permission: "ai.use", args: { "goal_id!": "uuid" }, about: "The forecast of ONE goal: expected value at the due date, an 80% range, the probability to reach the target." },
  { key: "goals.set", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "title!": "string", "metric!": "string", "target!": "number", "due_date!": "string", baseline: "number", start_date: "string" }, about: "PROPOSE a goal (metric: leads_new|deals_won|revenue_won|conversations|reviews_avg|reply_minutes|custom; dates as YYYY-MM-DD). It stays proposed until the owner activates it. Never invent a target the owner did not ask for or the data does not support." },
  { key: "experiments.list", kind: "read", sensitivity: "internal", permission: "ai.use", args: {}, about: "Recommendations and A/B experiments with their metric, owner, sample size so far and the honest verdict ('not enough data' is a valid answer)." },
  { key: "experiments.propose", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "title!": "string", "hypothesis!": "string", "metric!": "string", "variant_a!": "string", "variant_b!": "string", baseline_rate: "number" }, about: "PROPOSE an A/B experiment (what is compared, the one metric that decides, the baseline rate if known). The owner activates it; the verdict comes only after the minimum sample size." },
  { key: "board.view", kind: "read", sensitivity: "internal", permission: "ai.use", args: {}, about: "The shared team board: who works on what, what is blocked, open handoff contracts and the latest daily stand-up." },
  { key: "board.post", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "title!": "string", "kind!": "string", detail: "string" }, about: "Post a note on the shared board (kind: blocker|finding|request|status) so teammates see it without a handoff." },
  { key: "reports.latest", kind: "read", sensitivity: "internal", permission: "analytics.read", args: { period: "string" }, about: "The latest weekly / monthly report (period: week|month) and the anomalies flagged by the thresholds." },
];

export const ROLE_EXTRA_TOOLS_7C: Record<string, string[]> = {
  manager: ["goals.list", "goals.forecast", "goals.set", "experiments.list", "experiments.propose", "board.view", "board.post", "reports.latest"],
  team_lead: ["goals.list", "goals.forecast", "board.view", "board.post", "experiments.list", "reports.latest"],
  analyst: ["goals.list", "goals.forecast", "experiments.list", "experiments.propose", "board.view", "board.post", "reports.latest"],
  marketing: ["goals.list", "experiments.list", "experiments.propose", "board.view", "board.post"],
  sales: ["goals.list", "board.view", "board.post"],
  customer_service: ["board.view", "board.post"],
  content_writer: ["board.view", "board.post"],
  web_builder: ["board.view", "board.post"],
  project_coordinator: ["goals.list", "board.view", "board.post", "reports.latest"],
  quality_control: ["board.view", "board.post"],
  collections: ["board.view", "board.post"],
  reputation: ["goals.list", "board.view", "board.post"],
};

/** union, order-preserving, never removes anything the member already has (applied after withRoleExtras7) */
export function withRoleExtras7c(role: string, tools: string[]): string[] {
  return [...new Set([...(tools ?? []), ...(ROLE_EXTRA_TOOLS_7C[role] ?? [])])];
}
