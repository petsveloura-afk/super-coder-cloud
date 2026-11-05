"use server";

import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { COPY_FRAMEWORKS, COPY_RULES, frameworkDirection, polishPostCopy, type CopyFramework } from "@/lib/social/post-quality";

/** The post editor's "professional rewrite": the person's own post rewritten with a copywriting framework (1 credit). */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");

export async function rewritePostAction(input: { locale: string; text: string; framework: string; platform: string }): Promise<ActionState<{ text: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const text = String(input.text ?? "").trim();
  const framework = (COPY_FRAMEWORKS as readonly string[]).includes(input.framework) ? (input.framework as CopyFramework) : "hook";
  const platform = input.platform === "instagram" ? "instagram" : "facebook";
  if (text.length < 10 || text.length > 5000) return { error: "validation.invalid" };
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
  const { runAISystem } = await import("@/lib/ai/run-system");
  const out = await runAISystem({
    orgId: ctx.org.id,
    feature: "social",
    agentId: (agent?.id as string | undefined) ?? null,
    system: [
      COPY_RULES,
      `Business: "${String(org?.name ?? "").slice(0, 120)}". Business information (for facts only):\n${String(agent?.instructions ?? "").slice(0, 2500)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 600)}` : "",
      `Platform: ${platform === "instagram" ? "Instagram (max 2200 characters)" : "Facebook"}.`,
      frameworkDirection(framework),
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [{ role: "user", content: text }],
    temperature: 0.75,
    maxTokens: 1200,
    patienceMs: 20_000,
  });
  if (!out.ok) return { error: out.error };
  const clean = polishPostCopy(out.text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").replace(/^["“]|["”]$/g, "")).slice(0, platform === "instagram" ? 2200 : 5000);
  if (clean.length < 10) return { error: "ai.failed" };
  return { ok: true, data: { text: clean } };
}
