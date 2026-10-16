import Link from "next/link";
import { triggerLabel } from "@/lib/labels";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ActionType, AutomationTrigger } from "@scc/shared/automations";
import { uuidSchema } from "@scc/shared/validators";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { AutomationBuilder, type BuilderValue } from "@/components/automations/builder";
import { DeleteAutomationButton } from "@/components/automations/delete-button";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { builderOptions } from "@/lib/automation-options";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { stepDetailLabel } from "@/components/automations/step-detail";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("automations.edit") };
}

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { success: "success", partial: "warning", failed: "danger", skipped: "neutral" };
const JOB_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = { done: "success", queued: "accent", running: "accent", failed: "warning", dead: "danger", canceled: "neutral" };

export default async function AutomationPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { id: rawId } = await params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("automations.manage")) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("automations")
    .select("id, name, description, enabled, trigger_type, trigger_config, conditions, actions, inbound_token")
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!a) notFound();
  const [options, { data: runs }, { data: jobs }] = await Promise.all([
    builderOptions(ctx.org.id),
    supabase.from("automation_runs").select("id, status, steps, error, created_at").eq("organization_id", ctx.org.id).eq("automation_id", a.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("jobs").select("id, kind, status, attempts, last_error, run_after, created_at").eq("organization_id", ctx.org.id).eq("automation_id", a.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const initial: BuilderValue = {
    name: a.name as string,
    description: (a.description as string | null) ?? "",
    enabled: Boolean(a.enabled),
    trigger_type: a.trigger_type as AutomationTrigger,
    trigger_config: (a.trigger_config as Record<string, string>) ?? {},
    conditions: (a.conditions as BuilderValue["conditions"]) ?? [],
    actions: ((a.actions as { type: ActionType; config: Record<string, unknown> }[]) ?? []).map((x) => ({ type: x.type, config: x.config ?? {} })),
  };
  const inboundUrl = a.trigger_type === "webhook.inbound" ? `${publicEnv.appUrl.replace(/\/$/, "")}/api/hooks/${a.inbound_token}` : undefined;
  const Back = locale === "en" ? ArrowLeft : ArrowRight;

  return (
    <>
      <Link href={`/${locale}/automations`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("automations.title")}
      </Link>
      <PageHeader title={a.name as string} description={triggerLabel(t, a.trigger_type as string)} actions={<DeleteAutomationButton id={a.id as string} />} />
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <AutomationBuilder id={a.id as string} initial={initial} options={options} inboundUrl={inboundUrl} />
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("automations.history")} />
            {(runs ?? []).length === 0 ? (
              <p className="p-5 text-center text-sm text-subtle">{t("automations.noRuns")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(runs ?? []).map((r) => (
                  <li key={r.id} className="px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={RUN_TONE[r.status as string] ?? "neutral"}>{t(`automations.runStatus.${r.status}`)}</Badge>
                      <span className="text-[12px] text-subtle">{formatDateTime(locale, r.created_at as string)}</span>
                    </div>
                    {(r.steps as { type: string; status: string; detail?: string }[]).length ? (
                      <ul className="mt-1.5 space-y-0.5 text-muted">
                        {(r.steps as { type: string; status: string; detail?: string }[]).map((s, i) => (
                          <li key={i} className={s.status === "error" ? "text-danger" : undefined}>
                            {t(`automations.actions.${s.type}`)} — {t(`automations.stepStatus.${s.status}`)}
                            {s.detail ? <span className="text-subtle"> — <bdi>{stepDetailLabel(t, s.detail)}</bdi></span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t("automations.jobs")} description={t("automations.jobsHint")} />
            {(jobs ?? []).length === 0 ? (
              <p className="p-5 text-center text-sm text-subtle">{t("automations.noJobs")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(jobs ?? []).map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
                    <Badge tone={JOB_TONE[j.status as string] ?? "neutral"}>{t(`automations.jobStatus.${j.status}`)}</Badge>
                    <span>{t(`automations.jobKinds.${j.kind}`)}</span>
                    <span className="text-[12px] text-subtle">×{j.attempts as number}</span>
                    {j.last_error ? <span className="w-full truncate text-[12px] text-danger">{j.last_error as string}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
