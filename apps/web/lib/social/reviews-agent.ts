import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAISystem } from "@/lib/ai/run-system";

/**
 * Wave 19 — Google reviews: every 30 minutes per business (integration google_business):
 * new reviews are pulled, the AI drafts a reply (thanks / apology + invitation), and 4-5★
 * replies are published automatically when the business switched that on.
 */
export function reviewReplyPrompt(locale: string, orgName: string): string {
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  return `You reply to Google reviews for "${orgName}" in ${lang} (or the reviewer's language). 1-3 sentences, warm and personal, mention a detail from the review. 4-5 stars: thank and invite back. 1-3 stars: apologise sincerely, no excuses, invite them to contact the business directly. Never invent facts, offers or names. Output only the reply.`;
}

export async function runReviewsSync(budgetMs = 20_000): Promise<{ businesses: number; added: number; drafted: number; posted: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: integ } = await admin.from("integrations").select("organization_id, config, last_success_at").eq("provider", "google_business").eq("status", "active").or(`last_success_at.is.null,last_success_at.lt.${since}`).limit(10);
  const { loadIntegration, markIntegration } = await import("@/lib/integrations/store");
  const { syncReviews, postReviewReply } = await import("@/lib/google/reviews");
  let added = 0;
  let drafted = 0;
  let posted = 0;
  let businesses = 0;
  for (const row of (integ ?? []) as { organization_id: string; config: { locations?: { name: string; account: string }[]; auto_reply_positive?: boolean } }[]) {
    if (Date.now() - started > budgetMs) break;
    const full = await loadIntegration(row.organization_id, "google_business");
    if (!full?.secrets.refresh_token) continue;
    businesses++;
    const r = await syncReviews(row.organization_id, full.secrets.refresh_token, row.config.locations ?? []);
    await markIntegration(full.id, !r.error, r.error ?? null);
    added += r.added;
    // drafts for new reviews
    const { data: fresh } = await admin.from("reviews").select("id, external_id, author, rating, body").eq("organization_id", row.organization_id).eq("status", "new").order("created_at").limit(5);
    if (!fresh?.length) continue;
    const [{ data: org }, { data: agent }] = await Promise.all([
      admin.from("organizations").select("name, locale").eq("id", row.organization_id).maybeSingle(),
      admin.from("ai_agents").select("id, provider, model").eq("organization_id", row.organization_id).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    ]);
    for (const rv of fresh as { id: string; external_id: string; author: string | null; rating: number | null; body: string }[]) {
      if (Date.now() - started > budgetMs) break;
      const out = await runAISystem({ orgId: row.organization_id, feature: "review_reply", agentId: (agent?.id as string | undefined) ?? null, provider: (agent?.provider as "openai" | "anthropic" | "gemini" | undefined) ?? undefined, model: (agent?.model as string | undefined) ?? undefined, system: reviewReplyPrompt(String(org?.locale ?? "he"), String(org?.name ?? "")), messages: [{ role: "user", content: `${rv.rating ?? "?"}★ from ${rv.author ?? "a customer"}: ${rv.body.slice(0, 2000) || "(no text)"}` }], temperature: 0.6, maxTokens: 220, patienceMs: 10_000 });
      if (!out.ok || !out.text.trim()) continue;
      const draft = out.text.trim().slice(0, 1500);
      drafted++;
      if (row.config.auto_reply_positive && (rv.rating ?? 0) >= 4) {
        const p = await postReviewReply(full.secrets.refresh_token, rv.external_id, draft);
        if (p.ok) {
          posted++;
          await admin.from("reviews").update({ ai_draft: draft, reply: draft, replied_at: new Date().toISOString(), status: "auto_replied" }).eq("id", rv.id);
          continue;
        }
      }
      await admin.from("reviews").update({ ai_draft: draft, status: "drafted" }).eq("id", rv.id);
    }
  }
  return { businesses, added, drafted, posted };
}
