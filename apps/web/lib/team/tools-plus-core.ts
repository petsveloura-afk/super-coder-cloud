/**
 * Upgrade 4 — additional tools and role grants (pure data). Merged into the catalog by tools-core (TOOLS.push) and into
 * an employee's allowed tools by roleExtraTools. Everything here is read-only except market.record, which only stores
 * a public finding inside the business's own data (internal sensitivity, never contacts anyone).
 */
import type { ToolSpec } from "./tools-core";

export const UPGRADE4_TOOLS: ToolSpec[] = [
  { key: "market.scan", kind: "read", sensitivity: "internal", permission: "analytics.read", args: { "query!": "string", competitor: "string" }, about: "Search PUBLIC web sources about a competitor or market topic (prices, promotions, new products, reviews, trends). Returns snippets with source links and read time. Says plainly when no search provider is configured — never invents data." },
  { key: "market.what_changed", kind: "read", sensitivity: "internal", permission: "analytics.read", args: { competitor: "string" }, about: "What changed in the recorded competitor findings between the previous scan and the latest one (price moves, new / gone promotions and products), with confidence and source." },
  { key: "market.record", kind: "write", sensitivity: "internal", permission: "ai.use", args: { "competitor!": "string", "kind!": "string", "subject!": "string", "summary!": "string", "source_url!": "string", value: "number", currency: "string", source_kind: "string", observed_at: "iso" }, about: "Record ONE public finding about a competitor (kind: price|promo|product|review|trend) with its source link. Public pages only; rejected when the link is not a public page." },
];

/** extra tools a role gets on top of what the member already has (read-only market research for the roles that need it) */
export const ROLE_EXTRA_TOOLS: Record<string, string[]> = {
  manager: ["market.what_changed"],
  analyst: ["market.scan", "market.what_changed", "market.record"],
  marketing: ["market.scan", "market.what_changed", "market.record"],
};

/** union, order-preserving, never removes anything the member already has */
export function withRoleExtras(role: string, tools: string[]): string[] {
  const extra = ROLE_EXTRA_TOOLS[role] ?? [];
  return [...new Set([...(tools ?? []), ...extra])];
}
