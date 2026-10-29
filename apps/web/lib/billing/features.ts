import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Wave 13 — plan features (plans.features) checked on the server.
 *   api_access          public REST API keys (Business and up)
 *   audit_log           audit log (Pro and up)
 *   site_pro_templates  premium website templates, AI images, multi-page legal pages
 *   site_ai_editor      edit the site with the AI agent
 *   site_custom_domain  connect / buy a domain for a site
 *   white_label         no "built with" badge on published sites
 */
export type PlanFeature =
  | "api_access"
  | "audit_log"
  | "site_pro_templates"
  | "site_ai_editor"
  | "site_custom_domain"
  | "white_label"
  | "ai_site_full"
  | "ai_images"
  // waves 15-18 (paid plans)
  | "contracts"
  | "lead_routing"
  | "invoicing_sync"
  | "ai_insights"
  | "voice_ai"
  | "calendar_sync"
  | "ab_testing"
  | "conversion_api"
  | "ai_copilot"
  | "flow_builder"
  | "advanced_analytics"
  // wave 55 (paid, with a 7-day free trial)
  | "voice_notes"
  | "ai_operator"
  | "ai_team"
  | "ai_team_plus";

/** For the signed-in member (RLS session). */
export async function orgHasFeature(orgId: string, feature: PlanFeature): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_feature", { p_org: orgId, p_feature: feature });
  if (error) return false;
  return data === true;
}

/** For server-only paths without a session (public API, webhooks). */
export async function orgHasFeatureAdmin(orgId: string, feature: PlanFeature): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("has_feature", { p_org: orgId, p_feature: feature });
  if (error) return false;
  return data === true;
}

/** Several features at once (one round trip per feature, cached per request by the caller). */
export async function orgFeatures(orgId: string, features: PlanFeature[]): Promise<Record<PlanFeature, boolean>> {
  const out = {} as Record<PlanFeature, boolean>;
  await Promise.all(features.map(async (f) => (out[f] = await orgHasFeature(orgId, f))));
  return out;
}

/** Wave 55 — features a business can try free for 7 days (once per feature). */
export const TRIAL_FEATURES: PlanFeature[] = ["voice_notes", "ai_operator", "ai_team", "ai_team_plus", "advanced_analytics", "flow_builder", "ai_insights"];

export interface FeatureAccess {
  allowed: boolean;
  /** "plan" (included), "trial" (active free trial) or null (locked) */
  via: "plan" | "trial" | null;
  trialAvailable: boolean;
  trialEndsAt: string | null;
}

/** Wave 55 — is the feature available, how (plan / trial), and can a trial still be started? */
export async function featureAccess(orgId: string, feature: PlanFeature): Promise<FeatureAccess> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("feature_access", { p_org: orgId, p_feature: feature });
  if (error || !data) {
    const allowed = await orgHasFeature(orgId, feature);
    return { allowed, via: allowed ? "plan" : null, trialAvailable: false, trialEndsAt: null };
  }
  const d = data as { allowed?: boolean; via?: string | null; trial_available?: boolean; trial_ends_at?: string | null };
  return { allowed: d.allowed === true, via: d.via === "plan" || d.via === "trial" ? d.via : null, trialAvailable: d.trial_available === true, trialEndsAt: d.trial_ends_at ?? null };
}
