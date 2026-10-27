"use server";

import { revalidatePath } from "next/cache";
import { siteSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveSiteAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const parsed = siteSchema.safeParse(input.data);
  if (!parsed.success) return { error: "websites.invalid", fieldErrors: fieldErrors(parsed.error) };
  const s = parsed.data;
  const row = {
    name: s.name,
    slug: s.slug,
    status: s.status,
    theme: s.theme,
    seo: s.seo,
    blocks: s.blocks,
    updated_at: new Date().toISOString(),
    // wave 13: business details + legal pages (only when the editor sent them)
    ...(s.settings !== undefined ? { settings: s.settings } : {}),
    ...(s.pages !== undefined ? { pages: Object.fromEntries(Object.entries(s.pages).filter(([, v]) => typeof v === "string" && v.trim())) } : {}),
  };
  const supabase = await createClient();
  // wave 13: premium templates are part of paid plans (a site that already uses one keeps it)
  const { templateByKey } = await import("@/lib/site/templates");
  if (s.theme.template && templateByKey(s.theme.template).pro) {
    const { orgHasFeature } = await import("@/lib/billing/features");
    if (!(await orgHasFeature(ctx.org.id, "site_pro_templates"))) {
      const prevTpl = input.id ? ((await supabase.from("sites").select("theme").eq("id", input.id).eq("organization_id", ctx.org.id).maybeSingle()).data?.theme as { template?: string } | null)?.template : undefined;
      if (prevTpl !== s.theme.template) return { error: "plans.locked.site_pro_templates.title" };
    }
  }
  const planLimit = (e: { message?: string } | null) => (e?.message?.includes("plan_limit:sites_published") ? { error: "plans.locked.sites_published.title" } : null);
  const taken = (code?: string) => (code === "23505" ? { error: "websites.slugTaken", fieldErrors: { slug: "websites.slugTaken" } } : null);
  if (input.id) {
    const id = uuidSchema.safeParse(input.id);
    if (!id.success) return { error: "validation.invalidId" };
    const { data: prev } = await supabase.from("sites").select("status, published_at, slug").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
    if (!prev) return { error: "errors.notFound" };
    const published_at = s.status === "published" ? ((prev.published_at as string | null) ?? new Date().toISOString()) : prev.published_at;
    const { error } = await supabase.from("sites").update({ ...row, published_at }).eq("id", id.data).eq("organization_id", ctx.org.id);
    if (error) return taken(error.code) ?? planLimit(error) ?? { error: dbErrorKey(error) };
    revalidatePath(`/${locale}/websites`);
    revalidatePath(`/${locale}/websites/${id.data}`);
    // wave 34: the public page of every language (and of the previous address, if the slug changed)
    const slugs = [...new Set([s.slug, (prev.slug as string | null) ?? s.slug])];
    for (const l of ["he", "ar", "en"]) for (const sl of slugs) revalidatePath(`/${l}/s/${sl}`);
    return { ok: true, message: s.status === "published" ? "websites.savedPublished" : "websites.saved", data: { id: id.data } };
  }
  const { data, error } = await supabase
    .from("sites")
    .insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId, published_at: s.status === "published" ? new Date().toISOString() : null })
    .select("id")
    .single();
  if (error) return taken(error.code) ?? planLimit(error) ?? { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "websites.created", data: { id: data.id as string } };
}

export async function deleteSiteAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("sites").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "websites.deleted" };
}

/* ------------------------------------------------- AI site builder (v5) */
export async function buildSiteWithAIAction(input: { locale: string; brief: string; full: boolean; template?: string }): Promise<ActionState<{ id: string; downgraded: boolean }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const brief = String(input.brief ?? "").trim();
  if (brief.length < 10) return { error: "websites.aiBriefShort" };
  const { buildSiteWithAI } = await import("@/lib/ai/site-builder");
  const r = await buildSiteWithAI({ orgId: ctx.org.id, userId: ctx.userId, locale, brief: brief.slice(0, 3000), wantFull: Boolean(input.full), template: typeof input.template === "string" ? input.template : undefined });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "ai.siteBuilt", data: { id: r.site.id, downgraded: r.site.downgraded } };
}

export async function heroImageAIAction(input: { locale: string; prompt: string }): Promise<ActionState<{ url: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const prompt = String(input.prompt ?? "").trim();
  if (prompt.length < 3) return { error: "websites.aiBriefShort" };
  const { aiHeroImage } = await import("@/lib/ai/site-builder");
  const r = await aiHeroImage(ctx.org.id, prompt);
  if (!r.ok) return { error: r.error };
  return { ok: true, data: { url: r.url } };
}

/* ------------------------------------------------ wave 13: images + AI editing */
const SITE_IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Uploads an image for a site section / gallery / team / logo (public URL). */
export async function uploadSiteImageAction(fd: FormData): Promise<ActionState<{ url: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "validation.required" };
  const ext = SITE_IMAGE_TYPES[file.type];
  if (!ext) return { error: "ai.setup.badImage" };
  if (file.size > 8 * 1024 * 1024) return { error: "ai.setup.tooBig" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "inbox.serverKeyMissing" };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_key: "site-upload", p_limit: 120, p_window_seconds: 3600 });
  if (allowed !== true) return { error: "errors.rateLimited" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const path = `${ctx.org.id}/sites/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from("site-assets").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { error: "ai.setup.uploadFailed" };
  return { ok: true, data: { url: admin.storage.from("site-assets").getPublicUrl(path).data.publicUrl } };
}

/** "Tell the agent what to change" — returns the edited site (not saved; the editor shows it for review). */
export async function aiEditSiteAction(input: { locale: string; instruction: string; site: unknown; allowProTemplates?: boolean }): Promise<ActionState<{ site: { name: string; theme: Record<string, unknown>; seo: { title: string; description: string }; blocks: unknown[] } }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "site_ai_editor"))) return { error: "plans.locked.site_ai_editor.title" };
  const instruction = String(input.instruction ?? "").trim();
  if (instruction.length < 3) return { error: "websites.aiBriefShort" };
  // wave 14: at most 40 AI edits per organization per hour
  const { data: allowedEdit } = await (await createClient()).rpc("check_rate_limit", { p_key: "site-ai-edit", p_limit: 40, p_window_seconds: 3600 });
  if (allowedEdit !== true) return { error: "errors.rateLimited" };
  const parsed = siteSchema.safeParse(input.site);
  if (!parsed.success) return { error: "websites.invalid", fieldErrors: fieldErrors(parsed.error) };
  const proTemplates = await orgHasFeature(ctx.org.id, "site_pro_templates");
  const { editSiteWithAI } = await import("@/lib/ai/site-edit");
  const r = await editSiteWithAI({ orgId: ctx.org.id, locale, instruction: instruction.slice(0, 2000), site: parsed.data, proTemplates });
  if (!r.ok) return { error: r.error };
  return { ok: true, data: { site: r.site } };
}

/** Wave 31 — duplicate a site as a new DRAFT (same content/design/settings; nothing is published, no leads/visits copied). */
export async function duplicateSiteAction(fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const { cloneSiteDraft } = await import("@/lib/site/clone");
  const r = await cloneSiteDraft(await createClient(), { orgId: ctx.org.id, userId: ctx.userId, locale, id: id.data });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "websites.duplicated", data: { id: r.id } };
}

/** Wave 32 — manage many sites at once (max 50): publish, unpublish, duplicate, delete. Plan limits are respected per site. */
export async function bulkSitesAction(input: { locale: string; ids: string[]; op: "publish" | "unpublish" | "duplicate" | "delete" }): Promise<ActionState<{ done: number; failed: number; limited: number }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage")) return { error: "errors.forbidden" };
  if (!["publish", "unpublish", "duplicate", "delete"].includes(input.op)) return { error: "validation.invalidId" };
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map((x) => uuidSchema.safeParse(x)).filter((x) => x.success).map((x) => x.data as string))].slice(0, 50);
  if (!ids.length) return { error: "validation.invalidId" };
  const supabase = await createClient();
  let done = 0;
  let failed = 0;
  let limited = 0;
  if (input.op === "delete") {
    const { data, error } = await supabase.from("sites").delete().in("id", ids).eq("organization_id", ctx.org.id).select("id");
    if (error) return { error: dbErrorKey(error) };
    done = data?.length ?? 0;
    failed = ids.length - done;
  } else if (input.op === "duplicate") {
    const { cloneSiteDraft } = await import("@/lib/site/clone");
    for (const id of ids) {
      const r = await cloneSiteDraft(supabase, { orgId: ctx.org.id, userId: ctx.userId, locale, id });
      if (r.ok) done++;
      else failed++;
    }
  } else {
    const { data: rows } = await supabase.from("sites").select("id, published_at").in("id", ids).eq("organization_id", ctx.org.id);
    failed += ids.length - (rows?.length ?? 0);
    for (const row of (rows ?? []) as { id: string; published_at: string | null }[]) {
      const patch = input.op === "publish" ? { status: "published", published_at: row.published_at ?? new Date().toISOString(), updated_at: new Date().toISOString() } : { status: "draft", updated_at: new Date().toISOString() };
      const { error } = await supabase.from("sites").update(patch).eq("id", row.id).eq("organization_id", ctx.org.id);
      if (!error) done++;
      else if (error.message?.includes("plan_limit:sites_published")) limited++;
      else failed++;
    }
  }
  revalidatePath(`/${locale}/websites`);
  return { ok: true, data: { done, failed, limited } };
}

/** Wave 32 — a landing page built by the agent from a campaign (its goal and message); saved as a DRAFT, nothing is published. */
export async function landingFromCampaignAction(input: { locale: string; campaignId: string }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("websites.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const cid = uuidSchema.safeParse(input.campaignId);
  if (!cid.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("campaigns").select("name, channel, subject, body").eq("id", cid.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "errors.notFound" };
  const { data: ok } = await supabase.rpc("check_rate_limit", { p_key: "landing-from-campaign", p_limit: 10, p_window_seconds: 3600 });
  if (ok !== true) return { error: "errors.rateLimited" };
  const brief = [
    `Build a focused landing page for the marketing campaign "${String(c.name).slice(0, 120)}" (${String(c.channel)}).`,
    `Goal: turn visitors from this campaign into leads - one clear offer, one main action (leave details / book / WhatsApp), minimal distractions.`,
    c.subject ? `Campaign subject line: ${String(c.subject).slice(0, 200)}` : "",
    `The campaign message the visitors came from (keep the same offer, tone and language - never invent prices, discounts or deadlines that are not in it):`,
    String(c.body ?? "").slice(0, 1800),
  ].filter(Boolean).join("\n");
  const { buildSiteWithAI } = await import("@/lib/ai/site-builder");
  const r = await buildSiteWithAI({ orgId: ctx.org.id, userId: ctx.userId, locale, brief, wantFull: false });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/${locale}/websites`);
  return { ok: true, message: "ai.siteBuilt", data: { id: r.site.id } };
}
