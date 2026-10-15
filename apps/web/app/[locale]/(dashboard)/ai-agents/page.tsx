import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot, KeyRound } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AgentChat, AgentDialog, AgentStatus, DeleteAgentButton, type AgentRow } from "@/components/ai/agents-client";
import { UsageMeter } from "@/components/billing/usage-meter";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MODELS, pickProvider } from "@/lib/ai/providers";
import { formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("ai.title") };
}

export default async function AIAgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.use")) redirect(`/${locale}/overview`);
  const { t } = await getT(locale);
  const supabase = await createClient();

  const [{ data: agentsData }, { data: ent }] = await Promise.all([
    supabase
      .from("ai_agents")
      .select("id, name, instructions, provider, model, temperature, language, enabled, allowed_tools")
      .eq("organization_id", ctx.org.id)
      .order("created_at", { ascending: true }),
    supabase.rpc("org_entitlements", { org: ctx.org.id }),
  ]);
  const agents = ((agentsData ?? []) as AgentRow[]).map((a) => ({ ...a, temperature: Number(a.temperature) }));
  const e = ((ent ?? []) as { limits: Record<string, number | null>; ai_credits_used: number }[])[0];
  const creditLimit = e?.limits?.ai_credits_monthly ?? null;
  const used = Number(e?.ai_credits_used ?? 0);
  const provider = pickProvider();
  const canManage = ctx.can("ai.manage");
  const defaults = { openai: DEFAULT_MODELS.openai, anthropic: DEFAULT_MODELS.anthropic, provider: provider ?? "anthropic" };

  return (
    <>
      <PageHeader title={t("ai.title")} description={t("ai.subtitle")} actions={canManage ? <AgentDialog defaults={defaults} /> : null} />

      {!provider ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" /> {t("ai.notConfigured")}
        </div>
      ) : null}
      {ctx.org.is_demo ? (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold">{t("ai.demoBlocked")}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <UsageMeter
              label={t("billing.aiCredits")}
              used={used}
              limit={creditLimit === null || creditLimit === undefined ? null : Number(creditLimit)}
              unlimitedLabel={t("billing.unlimited")}
              ofLabel={creditLimit === null || creditLimit === undefined ? "" : `${formatNumber(locale, used)} / ${formatNumber(locale, Number(creditLimit))}`}
            />
            <Link href={`/${locale}/billing`} className="mt-3 inline-block text-[13px] text-accent hover:underline">
              {t("billing.upgrade")}
            </Link>
          </Card>

          <Card>
            <CardHeader title={t("ai.agents")} />
            {agents.length === 0 ? (
              <EmptyState icon={<Bot className="h-6 w-6" />} title={t("ai.empty")} body={t("ai.emptyBody")} action={canManage ? <AgentDialog defaults={defaults} /> : undefined} />
            ) : (
              <ul className="divide-y divide-line">
                {agents.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="truncate text-[12px] text-subtle" dir="ltr">
                        {a.provider} · {a.model}
                      </div>
                    </div>
                    <AgentStatus enabled={a.enabled} />
                    {canManage ? (
                      <>
                        <AgentDialog agent={a} defaults={defaults} />
                        <DeleteAgentButton id={a.id} />
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title={t("ai.testChat")} description={t("ai.testChatHint")} />
          <div className="p-5">
            <AgentChat agents={agents} />
          </div>
        </Card>
      </div>
    </>
  );
}
