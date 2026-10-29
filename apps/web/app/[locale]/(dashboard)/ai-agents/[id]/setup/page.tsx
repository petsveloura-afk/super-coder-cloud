import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, MessagesSquare } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { AgentSetup, type SetupAgent } from "@/components/ai/agent-setup";
import { FlowsEditor, GuardrailsCard, type FlowView, type RailsValue } from "@/components/ai/agent-plus";
import { VoicePersonaCard } from "@/components/ai/voice-persona-card";
import { FeatureLock, TrialNote } from "@/components/billing/feature-gate";
import { featureAccess } from "@/lib/billing/features";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("ai.setup.title") };
}

/** Full conversation setup of one agent: script, details to collect, pricing, links, menu, gallery. */
export default async function AgentSetupPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) redirect(`/${locale}/ai-agents`);
  if (!uuidSchema.safeParse(id).success) notFound();
  const { t } = await getT(locale);
  const supabase = await createClient();
  const { data: agent } = await supabase.from("ai_agents").select("id, name, lead_goal, profile").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!agent) notFound();
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const [{ data: railsRow }, { data: flowRows }, flowsOn] = await Promise.all([
    supabase.from("ai_agents").select("guardrails").eq("id", id).maybeSingle(),
    supabase.from("agent_flows").select("id, name, enabled, trigger_keywords, on_first_message, nodes, runs, completions").eq("organization_id", ctx.org.id).eq("agent_id", id).order("created_at"),
    import("@/lib/billing/features").then((m) => m.orgHasFeature(ctx.org.id, "flow_builder")),
  ]);
  const { normalizeGuardrails } = await import("@/lib/ai/guardrails");
  const rails = normalizeGuardrails((railsRow as { guardrails?: unknown } | null)?.guardrails) as RailsValue;
  const { validFlowNodes } = await import("@/lib/ai/flows-core");
  const flows = ((flowRows ?? []) as (Omit<FlowView, "nodes"> & { nodes: unknown })[]).map((f) => ({ ...f, nodes: validFlowNodes(f.nodes) }));
  const { ttsConfigured } = await import("@/lib/ai/tts");
  const ttsReady = ttsConfigured();
  // wave 55: the agent's voice persona (null before the migration ran → the card is hidden)
  const { data: voiceRow, error: voiceErr } = await supabase.from("ai_agents").select("voice").eq("id", id).maybeSingle();
  const { normalizeVoice } = await import("@/lib/ai/voice-persona-core");
  const voice = voiceErr || !voiceRow ? null : normalizeVoice((voiceRow as { voice?: unknown }).voice);
  // wave 55: voice answers + voice persona are a paid feature (Pro) with a 7-day free trial
  const voiceAccess = await featureAccess(ctx.org.id, "voice_notes");
  return (
    <>
      <Link href={`/${locale}/ai-agents`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("ai.title")}
      </Link>
      <PageHeader
        title={t("ai.setup.titleFor", { name: agent.name as string })}
        description={t("ai.setup.subtitle")}
        actions={
          <Link href={`/${locale}/ai-agents`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-hover">
            <MessagesSquare className="h-4 w-4" /> {t("ai.setup.test")}
          </Link>
        }
      />
      <AgentSetup agent={agent as SetupAgent} />
      {/* wave 16: guardrails + conversation flows */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card id="guardrails">
          <CardHeader title={t("rails.title")} description={t("rails.subtitle")} />
          <GuardrailsCard agentId={agent.id as string} value={rails} ttsReady={ttsReady} />
        </Card>
        <Card id="flows">
          <CardHeader title={t("flows.title")} description={t("flows.subtitle")} />
          <FlowsEditor agentId={agent.id as string} flows={flows} locked={!flowsOn} />
        </Card>
      </div>
      {/* wave 55: voice persona (ElevenLabs / OpenAI) + speech-to-text glossary */}
      {voice ? (
        <Card id="voice" className="mt-4">
          <CardHeader title={t("voicePersona.title")} description={t("voicePersona.subtitle")} />
          {voiceAccess.allowed ? (
            <div className="px-5 pt-4">
              <TrialNote locale={locale} access={voiceAccess} />
            </div>
          ) : (
            <div className="px-5 pt-4">
              <FeatureLock locale={locale} feature="voice_notes" plan="pro" access={voiceAccess} canTrial={ctx.can("billing.manage") || ctx.can("ai.manage")} />
            </div>
          )}
          {voiceAccess.allowed ? <VoicePersonaCard agentId={agent.id as string} value={voice} ttsReady={ttsReady} /> : null}
        </Card>
      ) : null}
    </>
  );
}
