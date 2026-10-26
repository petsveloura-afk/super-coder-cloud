import Link from "next/link";
import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AgentsHub, type AgentView } from "@/components/agents/agents-hub";
import { AgentsBrain } from "@/components/agents/agents-brain";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { AGENTS, AGENT_DEFAULTS } from "@/lib/agents/core";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("agents.title") };
}

/** Wave 19 — the business's AI team: what each agent does, on/off, settings, and what it did. */
export default async function AgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("ai.use")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const [{ data: settings }, { data: runs }, { data: convAgent }] = await Promise.all([
    supabase.from("agent_settings").select("agent, enabled, config, last_run_at").eq("organization_id", ctx.org.id),
    supabase.from("agent_runs").select("id, agent, summary, actions, created_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(60),
    supabase.from("ai_agents").select("name, enabled").eq("organization_id", ctx.org.id).order("created_at").limit(1).maybeSingle(),
  ]);
  const views: AgentView[] = AGENTS.map((key) => {
    const s = ((settings ?? []) as { agent: string; enabled: boolean; config: Record<string, unknown>; last_run_at: string | null }[]).find((x) => x.agent === key);
    return {
      key,
      enabled: Boolean(s?.enabled),
      config: { ...AGENT_DEFAULTS[key].config, ...(s?.config ?? {}) } as Record<string, number | boolean | string>,
      lastRunAt: s?.last_run_at ?? null,
      runs: ((runs ?? []) as { id: number; agent: string; summary: string; actions: number; created_at: string }[]).filter((r) => r.agent === key).slice(0, 8),
    };
  });
  return (
    <>
      <PageHeader title={t("agents.title")} description={t("agents.subtitle")} />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4" data-testid="conversation-agent-link">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("agents.conversation.title")}</p>
          <p className="text-[13px] text-muted">{convAgent ? t("agents.conversation.on", { name: (convAgent.name as string) ?? "" }) : t("agents.conversation.off")}</p>
        </div>
        <Link href={`/${locale}/ai-agents`} className="text-sm font-semibold text-accent hover:underline">
          {t("agents.conversation.open")}
        </Link>
      </Card>
      <AgentsBrain agents={views} canManage={ctx.can("ai.manage")} />
      <AgentsHub agents={views} canManage={ctx.can("ai.manage")} />
    </>
  );
}
