import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { commentIntent, type PageComment } from "@/lib/channels/meta-pages-core";
import { runAISystem } from "@/lib/ai/run-system";

/**
 * Wave 19 — comments under the business's Facebook / Instagram posts.
 *  1. stored once (comments board) + automation trigger "social.comment"
 *  2. spam is hidden (when enabled)
 *  3. the agent drafts a short public reply in the business's voice (published when auto-reply is on)
 *  4. buying intent ("price?", "details?") → one private DM that opens a conversation in the inbox,
 *     where the conversation agent continues (one conversation state for all channels)
 */
export interface SocialSettings {
  comment_drafts: boolean;
  comment_auto_reply: boolean;
  comment_private_reply: boolean;
  hide_spam: boolean;
  content_plan: boolean;
  auto_publish: boolean;
  posts_per_week: number;
  brand_voice: string | null;
}

export const DEFAULT_SOCIAL: SocialSettings = { comment_drafts: true, comment_auto_reply: false, comment_private_reply: true, hide_spam: true, content_plan: false, auto_publish: false, posts_per_week: 3, brand_voice: null };

export async function loadSocialSettings(orgId: string): Promise<SocialSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("social_settings").select("*").eq("organization_id", orgId).maybeSingle();
  return { ...DEFAULT_SOCIAL, ...((data as Partial<SocialSettings> | null) ?? {}) };
}

export function privateReplyText(locale: string, intent: string): string {
  if (locale === "en") return intent === "lead" ? "Hi! 👋 Thanks for your comment — I'm sending you the details here. What exactly are you looking for?" : "Hi! 👋 Thanks for your comment. How can I help?";
  if (locale === "ar") return intent === "lead" ? "مرحبًا! 👋 شكرًا على تعليقك — أرسل لك التفاصيل هنا. ما الذي تبحث عنه بالضبط؟" : "مرحبًا! 👋 شكرًا على تعليقك. كيف يمكنني مساعدتك؟";
  return intent === "lead" ? "היי! 👋 תודה על התגובה, אני שולח/ת לך כאן את הפרטים. מה בדיוק מעניין אותך?" : "היי! 👋 תודה על התגובה. איך אפשר לעזור?";
}

export async function handleSocialComment(orgId: string, accountId: string, c: PageComment): Promise<void> {
  const admin = createAdminClient();
  const intent = commentIntent(c.text);
  const { data: rec } = await admin.rpc("record_social_comment", {
    p_org: orgId,
    p_platform: c.platform,
    p_comment_id: c.commentId,
    p_post_id: c.postId,
    p_parent_id: c.parentId,
    p_author_id: c.authorId,
    p_author_name: c.authorName,
    p_body: c.text,
    p_sentiment: intent,
  });
  const r = (rec ?? {}) as { ok?: boolean; duplicate?: boolean; id?: string };
  if (!r.ok || r.duplicate || !r.id) return;
  const settings = await loadSocialSettings(orgId);
  const { loadAccountById } = await import("./accounts");
  const acc = await loadAccountById(accountId);
  const token = acc?.secrets.page_token ?? "";
  if (!token) return;
  const meta = await import("@/lib/channels/meta-pages");

  if (intent === "spam" && settings.hide_spam) {
    const h = await meta.hideComment(c.platform, c.commentId, token, true);
    if (h.ok) await admin.from("social_comments").update({ status: "hidden" }).eq("id", r.id);
    return;
  }
  const { data: agent } = await admin.from("ai_agents").select("id, name, instructions, language, provider, model").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle();
  const locale = (agent?.language as string | undefined) === "en" ? "en" : (agent?.language as string | undefined) === "ar" ? "ar" : "he";

  // buying intent → a private DM (Meta allows one private reply per comment, within 7 days)
  if ((intent === "lead" || intent === "question") && settings.comment_private_reply) {
    const dm = await meta.privateReplyToComment(c.commentId, token, privateReplyText(locale, intent));
    if (dm.ok) await admin.from("social_comments").update({ status: "dm_sent" }).eq("id", r.id);
  }
  if (!settings.comment_drafts || !agent) return;
  const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  const system = [
    `You manage the ${c.platform === "instagram" ? "Instagram" : "Facebook"} comments of "${(org?.name as string | undefined) ?? ""}". Business information:\n${String(agent.instructions ?? "").slice(0, 4000)}`,
    settings.brand_voice ? `Brand voice: ${settings.brand_voice.slice(0, 600)}` : "",
    "Write ONE short public reply (max 2 sentences) in the commenter's language. Warm, human, on-brand. Never invent prices or facts that are not in the business information; for prices/details say we sent a private message. For complaints: apologise and invite them to a private message. No hashtags. Output only the reply.",
  ].filter(Boolean).join("\n\n");
  const out = await runAISystem({ orgId, feature: "social", agentId: agent.id as string, provider: agent.provider as "openai" | "anthropic" | "gemini", model: agent.model as string, system, messages: [{ role: "user", content: `${c.authorName ?? "Someone"} commented: ${c.text.slice(0, 1500)}` }], temperature: 0.6, maxTokens: 200 });
  if (!out.ok || !out.text.trim()) return;
  const draft = out.text.trim().replace(/^["“]|["”]$/g, "").slice(0, 1000);
  await admin.from("social_comments").update({ ai_draft: draft }).eq("id", r.id);
  if (settings.comment_auto_reply && intent !== "negative") {
    const rep = await meta.replyToComment(c.platform, c.commentId, token, draft);
    if (rep.ok) await admin.from("social_comments").update({ status: "auto_replied", reply_text: draft, replied_at: new Date().toISOString() }).eq("id", r.id);
  }
}
