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
  | "advanced_analytics";

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
