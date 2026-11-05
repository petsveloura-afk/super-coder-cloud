/**
 * Wave 66 — model hint by kind of work (pure, unit-tested). Only ADDS a statement to the choice of MODEL inside a provider:
 *   "fast"   → short work (classify, summarise): the faster / cheaper model of the provider first
 *   "strong" → heavy work (plan, analyse): the stronger model of the provider first
 * It never changes which provider is tried first, never touches the provider the agent / the team asked for (routeProvider,
 * routeModel and the agent's own model keep their place), and never adds or removes a candidate.
 */
import { profileOf } from "@/lib/team/routing-core";
import { reorderWithin } from "./provider-health-core";

export type ModelHint = "fast" | "strong";

/** features that are short work (summaries, classification, transcription) */
const FAST = new Set(["contact_summary", "segment", "transcribe", "brief"]);
/** features that are heavy work (analysis, planning, forecasting, building) */
const STRONG = new Set(["insights", "forecast", "sales_manager", "site_builder"]);

/** the hint of an AI feature; null = no opinion (live conversations, writing, vision and unknown features keep today's behaviour) */
export function hintForFeature(feature: string | null | undefined): ModelHint | null {
  if (!feature) return null;
  if (FAST.has(feature)) return "fast";
  if (STRONG.has(feature)) return "strong";
  return null;
}

/**
 * Models of each provider re-ordered by the hint (stable; keys of one model stay in their order). The `preferred` provider is
 * left exactly as it is: that is the agent's / the team's explicit choice.
 */
export function hintOrder<T extends { provider: string; model: string }>(cands: T[], hint: ModelHint | null | undefined, preferred?: string | null): T[] {
  if (!hint) return cands;
  const score = (c: T): number => {
    const p = profileOf(c.provider, c.model);
    return hint === "fast" ? p.speed * 10 - p.cost : p.quality * 10 + p.writing;
  };
  return reorderWithin(
    cands,
    (c) => c.provider,
    (a, b) => (preferred && a.provider === preferred ? 0 : score(b) - score(a)),
  );
}
