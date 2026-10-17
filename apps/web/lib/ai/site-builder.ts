import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/config";
import { runAI } from "./run";
import { generateAndStoreImage, imagesConfigured } from "./images";
import { extractJson, normalizeAiSite, siteJsonInstructionsPro, siteSlug, type SiteMode } from "./site-json";
import { FREE_TEMPLATES, TEMPLATES } from "@/lib/site/templates";
import type { AIMessage, AIProviderName } from "./providers";

/** What the organization's plan allows: every plan builds landing pages; paid plans full sites + AI images. */
export async function aiSiteCaps(orgId: string): Promise<{ full: boolean; images: boolean; plan: string; proTemplates?: boolean; aiEditor?: boolean; customDomain?: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("org_entitlements", { org: orgId });
  const row = ((data ?? []) as { plan_key: string; features: string[] | null }[])[0];
  const f = row?.features ?? [];
  // wave 13: premium templates, AI editing and custom domains
  return { full: f.includes("ai_site_full"), images: f.includes("ai_images") && imagesConfigured(), plan: row?.plan_key ?? "free", proTemplates: f.includes("site_pro_templates"), aiEditor: f.includes("site_ai_editor"), customDomain: f.includes("site_custom_domain") };
}

export interface BuiltSite {
  id: string;
  name: string;
  slug: string;
  mode: SiteMode;
  image: boolean;
  /** asked for a full site but the plan only allows a landing page */
  downgraded: boolean;
}

export type BuildSiteResult = { ok: true; site: BuiltSite } | { ok: false; error: string };

/**
 * Design a site with AI from a brief (+ optional conversation) and save it as a DRAFT
 * in the Websites module. Validation happens in normalizeAiSite; nothing is published.
 */
export async function buildSiteWithAI(input: {
  orgId: string;
  userId: string;
  locale: Locale;
  brief: string;
  wantFull?: boolean;
  conversation?: AIMessage[];
  provider?: AIProviderName;
  agentId?: string | null;
  /** wave 13: a design template the business picked (else the AI chooses) */
  template?: string;
}): Promise<BuildSiteResult> {
  const supabase = await createClient();
  const caps = await aiSiteCaps(input.orgId);
  const mode: SiteMode = input.wantFull && caps.full ? "full" : "landing";
  const [{ data: form }, { data: booking }] = await Promise.all([
    supabase.from("forms").select("slug").eq("organization_id", input.orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    supabase.from("appointment_types").select("slug").eq("organization_id", input.orgId).eq("status", "active").order("created_at").limit(1).maybeSingle(),
  ]);
  const ctx = { formSlug: (form?.slug as string | undefined) ?? null, bookingSlug: (booking?.slug as string | undefined) ?? null };

  const transcript = (input.conversation ?? [])
    .slice(-16)
    .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content.slice(0, 1500)}`)
    .join("\n");
  const userPrompt = [
    `Brief: ${input.brief.slice(0, 3000)}`,
    transcript ? `\nConversation so far (use every concrete detail the customer gave):\n${transcript}` : "",
  ].join("");

  const out = await runAI({
    orgId: input.orgId,
    feature: "site_builder",
    agentId: input.agentId ?? null,
    provider: input.provider,
    system: siteJsonInstructionsPro(mode, input.locale, ctx, caps.proTemplates ? TEMPLATES.map((t) => t.key) : FREE_TEMPLATES),
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.6,
    maxTokens: mode === "full" ? 6000 : 3500,
    json: true,
  });
  if (!out.ok) return { ok: false, error: out.error };
  const site = normalizeAiSite(extractJson(out.text), mode, ctx, input.brief.split(/[.,\n]/)[0] ?? "", { templates: caps.proTemplates ? TEMPLATES.map((t) => t.key) : FREE_TEMPLATES });
  if (!site) {
    console.error("ai site json unusable", out.text.slice(0, 300));
    return { ok: false, error: "websites.aiInvalid" };
  }

  // hero image (paid plans) — a failure never blocks the site
  let image = false;
  if (caps.images && site.imagePrompt) {
    const { data: usageId } = await supabase.rpc("reserve_ai_credits", { p_org: input.orgId, p_feature: "image_gen", p_agent: input.agentId ?? null });
    if (usageId !== null && usageId !== undefined) {
      try {
        const img = await generateAndStoreImage(input.orgId, `${site.imagePrompt}. Professional, high quality, modern, website hero photo, no text, no watermark.`);
        const hero = site.blocks.find((b) => b.type === "hero");
        if (hero && hero.type === "hero") hero.data.image_url = img.url;
        image = true;
        await supabase.rpc("finalize_ai_usage", { p_usage_id: usageId, p_provider: "gemini", p_model: img.model, p_input: 4000, p_output: 0, p_ok: true });
      } catch (e) {
        console.error("ai hero image failed", (e as Error).message);
        await supabase.rpc("finalize_ai_usage", { p_usage_id: usageId, p_provider: "gemini", p_model: "image", p_input: 0, p_output: 0, p_ok: false });
      }
    }
  }

  // wave 13: the template the business picked wins (when the plan allows it)
  if (input.template) {
    const tpl = TEMPLATES.find((x) => x.key === input.template);
    if (tpl && (!tpl.pro || caps.proTemplates)) site.theme = { ...site.theme, template: tpl.key, accent2: site.theme.accent2 ?? tpl.accent2, mode: tpl.mode };
  }
  const slug = siteSlug(site.name, randomBytes(4).toString("hex"));
  const { data: row, error } = await supabase
    .from("sites")
    .insert({ organization_id: input.orgId, name: site.name, slug, status: "draft", theme: site.theme, seo: site.seo, blocks: site.blocks, created_by: input.userId })
    .select("id, name, slug")
    .single();
  if (error || !row) {
    console.error("ai site insert failed", error?.message);
    return { ok: false, error: "errors.generic" };
  }
  return { ok: true, site: { id: row.id as string, name: row.name as string, slug: row.slug as string, mode, image, downgraded: Boolean(input.wantFull) && !caps.full } };
}

/** Image for an existing site's hero (paid plans) — returns the public URL. */
export async function aiHeroImage(orgId: string, prompt: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const caps = await aiSiteCaps(orgId);
  if (!caps.images) return { ok: false, error: "websites.aiImagesPaid" };
  const supabase = await createClient();
  const { data: usageId, error: reserveError } = await supabase.rpc("reserve_ai_credits", { p_org: orgId, p_feature: "image_gen", p_agent: null });
  if (reserveError || usageId === null) return { ok: false, error: reserveError?.message?.includes("plan_limit") ? "ai.limitReached" : "ai.failed" };
  try {
    const img = await generateAndStoreImage(orgId, `${prompt.slice(0, 800)}. Professional, high quality, modern, website hero photo, no text, no watermark.`);
    await supabase.rpc("finalize_ai_usage", { p_usage_id: usageId, p_provider: "gemini", p_model: img.model, p_input: 4000, p_output: 0, p_ok: true });
    return { ok: true, url: img.url };
  } catch (e) {
    console.error("ai image failed", (e as Error).message);
    await supabase.rpc("finalize_ai_usage", { p_usage_id: usageId, p_provider: "gemini", p_model: "image", p_input: 0, p_output: 0, p_ok: false });
    return { ok: false, error: /_(429|5\d\d)\b/.test((e as Error).message) ? "ai.busy" : "websites.aiImageFailed" };
  }
}
