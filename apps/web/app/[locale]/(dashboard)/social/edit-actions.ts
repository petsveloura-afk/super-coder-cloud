"use server";

import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { COPY_RULES, polishPostCopy } from "@/lib/social/post-quality";
import { changesLanguage, editDirection, isPostEdit } from "@/lib/social/post-edits-core";

/**
 * The post editor's quick AI edits (longer, warmer, professional, call to action, spelling, emojis, platform fit,
 * translate). Same permissions, rate limit and credit metering as the professional rewrite (copy-actions.ts, unchanged).
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

export async function editPostAction(input: { locale: string; text: string; edit: string; platform: string }): Promise<ActionState<{ text: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  if (!isPostEdit(input.edit)) return { error: "validation.invalid" };
  const edit = input.edit;
  const text = String(input.text ?? "").trim();
  const platform = input.platform === "instagram" ? "instagram" : "facebook";
  if (text.length < 5 || text.length > 5000) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialai:${ctx.org.id}`, p_limit: 8, p_window_seconds: 60 });
  if (allowed === false) return { error: "ai.busy" };
  const [{ data: org }, { data: agent }, { data: social }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", ctx.org.id).maybeSingle(),
    admin.from("ai_agents").select("id, instructions").eq("organization_id", ctx.org.id).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    admin.from("social_settings").select("brand_voice").eq("organization_id", ctx.org.id).maybeSingle(),
  ]);
  // translations are the one edit allowed to change the language — every other rule (facts, no invented prices) stays
  const rules = changesLanguage(edit) ? COPY_RULES.replace("Write in the SAME language as the original post. ", "") : COPY_RULES;
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    agentId: (agent?.id as string | undefined) ?? null,
    system: [
      rules,
      `Business: "${String(org?.name ?? "").slice(0, 120)}". Business information (for facts only):\n${String(agent?.instructions ?? "").slice(0, 2500)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 600)}` : "",
      `Platform: ${platform === "instagram" ? "Instagram (max 2200 characters)" : "Facebook"}.`,
      `EDIT: ${editDirection(edit, platform)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [{ role: "user", content: text }],
    temperature: edit === "grammar" ? 0.1 : edit.startsWith("translate_") ? 0.3 : 0.6,
    maxTokens: 1400,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const raw = out.text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").replace(/^["“]|["”]$/g, "");
  // spelling / emoji edits keep the person's own layout; the other edits get the same safe tidy as the rewrite
  const clean = (edit === "grammar" || edit.startsWith("emojis_") ? raw.trim() : polishPostCopy(raw)).slice(0, platform === "instagram" ? 2200 : 5000);
  if (clean.length < 5) return { error: "ai.failed" };
  return { ok: true, data: { text: clean } };
}
