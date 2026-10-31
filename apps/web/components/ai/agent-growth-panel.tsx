import { Card, CardHeader } from "@/components/ui/primitives";
import { CoachCard, LearningInbox, type CoachView, type LearningItem } from "@/components/ai/agent-growth";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

/**
 * Wave 59 — under the agents: "the agent learned from you" (approve answers the team gave) and the weekly
 * AI coach. Hidden quietly before the migration ran.
 */
export async function AgentGrowthPanel({ orgId, locale, canManage, firstAgentId }: { orgId: string; locale: "he" | "en" | "ar"; canManage: boolean; firstAgentId: string | null }) {
  const supabase = await createClient();
  const { t } = await getT(locale);
  const [learnRes, coachRes] = await Promise.all([
    canManage ? supabase.from("ai_learning_suggestions").select("id, question, answer, created_at").eq("organization_id", orgId).eq("status", "pending").order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: null, error: null }),
    supabase.from("ai_coach_reports").select("week_start, stats, insights").eq("organization_id", orgId).order("week_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const learnReady = canManage && !learnRes.error;
  const coachReady = !coachRes.error;
  if (!learnReady && !coachReady) return null;
  const row = coachRes.data as { week_start: string; stats: CoachView["stats"]; insights: CoachView["insights"] } | null;
  const report: CoachView | null = row ? { week: row.week_start, stats: row.stats, insights: row.insights ?? {} } : null;
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {coachReady ? (
        <Card id="coach" className="overflow-hidden bento-glow">
          <CardHeader title={t("coach.title")} description={t("coach.subtitle")} />
          <CoachCard report={report} setupHref={canManage && firstAgentId ? `/${locale}/ai-agents/${firstAgentId}/setup` : null} canRun={canManage} />
        </Card>
      ) : null}
      {learnReady ? (
        <Card id="learn">
          <CardHeader title={t("learn.title")} description={t("learn.subtitle")} />
          <LearningInbox items={(learnRes.data ?? []) as LearningItem[]} />
        </Card>
      ) : null}
    </div>
  );
}
