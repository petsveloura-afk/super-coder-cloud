/**
 * Wave 17 — AI segmentation (pure, unit-tested): the prompt and a strict parser that
 * keeps only known audience filters (the campaign schema validates them again).
 */
import { campaignSchema } from "@scc/shared/engagement";
import { CONTACT_STATUSES, LEAD_SOURCES } from "@scc/shared/validators";
import { extractJsonObject } from "@/lib/crm/insights-core";

export function buildSegmentPrompt(text: string, tags: string[]): string {
  return [
    "Build campaign audience filters from the request. Use ONLY these keys (omit what the request does not ask for):",
    `- status: one of ${CONTACT_STATUSES.join("|")}`,
    `- source: one of ${LEAD_SOURCES.join("|")}`,
    `- tags: array of existing tags only: ${tags.slice(0, 200).join(", ") || "(none)"}`,
    "- min_score / max_score: lead score 0-100 (hot ≈ 70+, warm 40-69, cold < 40)",
    "- sentiment: positive|neutral|negative",
    "- stage: new|interested|considering|ready|customer|lost (buying stage)",
    "- active_days: wrote to us within the last N days",
    "- inactive_days: has NOT written for at least N days",
    "- purchases_min: total paid amount at least N",
    'Reply with one JSON object only, e.g. {"min_score":70,"inactive_days":30}.',
    "",
    `Request: ${text.slice(0, 600)}`,
  ].join("\n");
}

export function parseSegment(raw: string, knownTags?: string[]): Record<string, unknown> | null {
  const o = extractJsonObject(raw);
  if (!o) return null;
  if (knownTags && Array.isArray(o.tags)) {
    const known = new Set(knownTags.map((x) => x.toLowerCase()));
    o.tags = (o.tags as unknown[]).filter((x) => typeof x === "string" && known.has(x.toLowerCase()));
  }
  const allowed = ["status", "source", "tags", "min_score", "max_score", "sentiment", "stage", "active_days", "inactive_days", "purchases_min"];
  const picked: Record<string, unknown> = {};
  for (const k of allowed) if (o[k] !== undefined && o[k] !== null && o[k] !== "") picked[k] = o[k];
  // one invalid value never breaks the whole answer: drop fields that fail validation
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(picked)) {
    const r = campaignSchema.safeParse({ name: "x", channel: "email", subject: "x", body: "x", audience: { [k]: v } });
    if (r.success) {
      const val = (r.data.audience as Record<string, unknown>)[k];
      if (val !== undefined && !(Array.isArray(val) && val.length === 0)) out[k] = val;
    }
  }
  return Object.keys(out).length ? out : null;
}
