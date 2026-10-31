import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { coachStats, coachSystemPrompt, coachTranscript, coachWorthIt, normalizeCoach, weekStart, type CoachInsights, type CoachStats } from "./coach-core";

/**
 * Wave 59 — the weekly AI coach: once a week per business (cron) or on demand, the last 7 days of the
 * agent's conversations → numbers + why conversations did not close + concrete fixes, stored and sent to
 * the owners as a notification (and push). Never throws.
 */
export async function generateCoachReport(orgId: string): Promise<{ ok: boolean; error?: string; stats?: CoachStats; insights?: CoachInsights | null }> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [{ count: conversations }, { count: leads }, { count: handoffs }, { data: openRows }, { data: org }, { data: agent }] = await Promise.all([
      admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("last_customer_at", since),
      admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("lead_at", since),
      admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("handoff_at", since),
      admin.from("conversations").select("id").eq("organization_id", orgId).gte("last_customer_at", since).lte("last_customer_at", dayAgo).is("lead_at", null).neq("channel", "voice").order("last_customer_at", { ascending: false }).limit(40),
      admin.from("organizations").select("locale").eq("id", orgId).maybeSingle(),
      admin.from("ai_agents").select("id, provider, model, profile").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    ]);
    const lostIds = ((openRows ?? []) as { id: string }[]).map((r) => r.id);
    const stats = coachStats({ conversations: conversations ?? 0, leads: leads ?? 0, handoffs: handoffs ?? 0, lost: lostIds.length });
    const locale = String(org?.locale ?? "he");
    let insights: CoachInsights | null = null;
    if (coachWorthIt(stats) && lostIds.length) {
      const sample = lostIds.slice(0, 8);
      const { data: msgs } = await admin.from("messages").select("conversation_id, direction, body, ai_agent_id, created_at").in("conversation_id", sample).order("created_at").limit(400);
      const by = new Map<string, { direction: string; body: string; ai: boolean }[]>();
      for (const m of (msgs ?? []) as { conversation_id: string; direction: string; body: string; ai_agent_id: string | null }[]) {
        const list = by.get(m.conversation_id) ?? [];
        list.push({ direction: m.direction, body: m.body ?? "", ai: Boolean(m.ai_agent_id) });
        by.set(m.conversation_id, list);
      }
      const transcripts = [...by.values()].map((l, i) => `#${i + 1}\n${coachTranscript(l)}`).join("\n\n").slice(0, 12_000);
      const p = (agent?.profile ?? {}) as Record<string, unknown>;
      const { runAISystem } = await import("./run-system");
      const outcome = await runAISystem({
        orgId,
        feature: "insights",
        agentId: (agent?.id as string | undefined) ?? null,
        provider: (agent?.provider as "openai" | "anthropic" | "gemini" | undefined) ?? undefined,
        model: (agent?.model as string | undefined) ?? undefined,
        system: coachSystemPrompt(locale),
        messages: [{ role: "user", content: `Week numbers: ${JSON.stringify(stats)}\nAgent script: ${JSON.stringify(p.flow ?? [])}\nPricing policy: ${String(p.pricing ?? "").slice(0, 600)}\n\nConversations that did not close:\n${transcripts}` }],
        temperature: 0.3,
        maxTokens: 900,
        patienceMs: 20_000,
      });
      if (outcome.ok) {
        const { extractJson } = await import("./site-json");
        insights = normalizeCoach(extractJson(outcome.text));
      }
    }
    const { error } = await admin.from("ai_coach_reports").upsert({ organization_id: orgId, week_start: weekStart(new Date()), stats, insights: insights ?? {} }, { onConflict: "organization_id,week_start" });
    if (error) return { ok: false, error: "coach.notReady" };
    if (stats.conversations > 0) {
      const { notifyOwners } = await import("@/lib/agents/run");
      await notifyOwners(orgId, "coach.notification", { conversations: String(stats.conversations), leads: String(stats.leads) }, "/ai-agents#coach").catch(() => undefined);
    }
    return { ok: true, stats, insights };
  } catch (e) {
    console.error("coach failed", (e as Error).message);
    return { ok: false, error: "errors.generic" };
  }
}

/** Cron: businesses with an active agent and no report this week (a few per run). */
export async function runWeeklyCoach(limit = 3, budgetMs = 25_000): Promise<{ reports: number }> {
  const t0 = Date.now();
  const admin = createAdminClient();
  const week = weekStart(new Date());
  // reports are written on the first run of the week (Sunday onwards)
  const { data: agents } = await admin.from("ai_agents").select("organization_id").eq("enabled", true).limit(300);
  const orgs = [...new Set(((agents ?? []) as { organization_id: string }[]).map((a) => a.organization_id))];
  if (!orgs.length) return { reports: 0 };
  const { data: done, error } = await admin.from("ai_coach_reports").select("organization_id").eq("week_start", week).in("organization_id", orgs.slice(0, 300));
  if (error) return { reports: 0 };
  const have = new Set(((done ?? []) as { organization_id: string }[]).map((r) => r.organization_id));
  let reports = 0;
  for (const orgId of orgs) {
    if (reports >= limit || Date.now() - t0 > budgetMs) break;
    if (have.has(orgId)) continue;
    const r = await generateCoachReport(orgId);
    if (r.ok) reports++;
  }
  return { reports };
}
