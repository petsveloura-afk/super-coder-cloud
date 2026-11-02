/**
 * Upgrade 7 — additional tools and role grants (pure data). Merged into the catalog by tools-core (TOOLS.push) and into an
 * employee's allowed tools by withRoleExtras (tools-plus-core). The facts tools work on the business's versioned facts
 * (business-facts-core): lookup and history are read-only; facts.record can only PROPOSE or add an unconfirmed fact —
 * it can never overwrite what the owner confirmed (the newcomer waits for the owner's decision).
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE7_TOOLS: ToolSpec[] = [
  { key: "facts.lookup", kind: "read", sensitivity: "internal", permission: "ai.use", args: { "query!": "string" }, about: "Look up the business's recorded FACTS (prices, opening hours, policies, contact details, offers) relevant to a question, with version, source, date and whether the owner confirmed them. If nothing is returned, do not guess — say you are not sure." },
  { key: "facts.history", kind: "read", sensitivity: "internal", permission: "ai.use", args: { "label!": "string" }, about: "The version history of ONE fact (what the price / hours / policy was before, when it changed, who said so)." },
  { key: "facts.record", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "label!": "string", "value!": "string", "kind!": "string", unit: "string", "source_ref!": "string", observed_at: "iso", valid_to: "iso" }, about: "Record ONE business fact you learned (kind: price|hours|policy|contact|offer|other) with where you learned it (source_ref: a public link or a short description of the document / conversation). If it contradicts something the owner confirmed it is only PROPOSED to the owner. Never invent a fact." },
];

/** every employee may look facts up; the manager and the analyst may also record them */
export const ROLE_EXTRA_TOOLS_7: Record<string, string[]> = {
  manager: ["facts.lookup", "facts.history", "facts.record"],
  team_lead: ["facts.lookup", "facts.history"],
  customer_service: ["facts.lookup", "facts.history"],
  sales: ["facts.lookup", "facts.history"],
  marketing: ["facts.lookup", "facts.history"],
  content_writer: ["facts.lookup"],
  web_builder: ["facts.lookup"],
  analyst: ["facts.lookup", "facts.history", "facts.record"],
  project_coordinator: ["facts.lookup"],
  quality_control: ["facts.lookup", "facts.history"],
  collections: ["facts.lookup"],
  reputation: ["facts.lookup", "facts.history"],
};

/** union, order-preserving, never removes anything the member already has (applied after the upgrade-4 grants) */
export function withRoleExtras7(role: string, tools: string[]): string[] {
  return [...new Set([...(tools ?? []), ...(ROLE_EXTRA_TOOLS_7[role] ?? [])])];
}
