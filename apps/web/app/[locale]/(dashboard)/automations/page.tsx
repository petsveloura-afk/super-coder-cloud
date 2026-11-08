import Link from "next/link";
import type { Metadata } from "next";
import { Activity, AlertTriangle, CheckCircle2, Layers, PlayCircle, Plus, ShieldAlert, Workflow } from "lucide-react";
import { analyzeAutomation, automationHealth, dailyBuckets, summarizeRuns, type IntelDraft, type RunLike } from "@scc/shared/automations";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AutomationListView, type AutomationListItem } from "@/components/automations/list-view";
import { RecipeGallery } from "@/components/automations/recipe-gallery";
import { KpiTile } from "@/components/automations/visuals";
import { intelT } from "@/components/automations/intel-i18n";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("automations.title") };
}

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { success: "success", partial: "warning", failed: "danger", skipped: "neutral" };

const STATS_DAYS = 30;
/** ISO timestamp `days` ago (kept outside the component: it is a clock read). */
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default async function AutomationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("automations.manage")) {
    return (
      <Card>
        <EmptyState icon={<Workflow className="h-6 w-6" />} title={t("errors.forbidden")} body={t("automations.noPermission")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const it = intelT(locale);
  const since = sinceIso(STATS_DAYS);
  const [{ data: automations }, { data: runs }, { count: dead }, { count: queued }, { data: statRuns }, { count: executed30 }, { count: success30 }] = await Promise.all([
    supabase.from("automations").select("id, name, description, enabled, trigger_type, trigger_config, conditions, actions, run_count, last_run_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }),
    supabase.from("automation_runs").select("id, automation_id, status, created_at, error").eq("organization_id", ctx.org.id).neq("status", "skipped").order("created_at", { ascending: false }).limit(15),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "dead"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "queued"),
    // per-automation health / trend (latest 1000 runs of the window; the KPI tiles use exact counts below)
    supabase.from("automation_runs").select("automation_id, status, created_at").eq("organization_id", ctx.org.id).gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).neq("status", "skipped").gte("created_at", since),
    supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "success").gte("created_at", since),
  ]);
  const list = automations ?? [];
  const nameOf = new Map(list.map((a) => [a.id as string, a.name as string]));

  const runsBy = new Map<string, RunLike[]>();
  for (const r of statRuns ?? []) {
    const k = r.automation_id as string;
    const arr = runsBy.get(k);
    const row = { status: r.status as string, created_at: r.created_at as string };
    if (arr) arr.push(row);
    else runsBy.set(k, [row]);
  }
  const nowMs = Date.parse(sinceIso(0));
  const items: AutomationListItem[] = list.map((a) => {
    const rs = runsBy.get(a.id as string) ?? [];
    const summary = summarizeRuns(rs);
    const draft: IntelDraft = {
      name: a.name as string,
      enabled: Boolean(a.enabled),
      trigger_type: a.trigger_type as string,
      trigger_config: (a.trigger_config as Record<string, string> | null) ?? {},
      conditions: (a.conditions as IntelDraft["conditions"]) ?? [],
      actions: (a.actions as IntelDraft["actions"]) ?? [],
    };
    const analysis = analyzeAutomation(draft);
    return {
      id: a.id as string,
      name: a.name as string,
      description: (a.description as string | null) ?? null,
      enabled: Boolean(a.enabled),
      trigger_type: a.trigger_type as string,
      run_count: Number(a.run_count),
      last_run_at: (a.last_run_at as string | null) ?? null,
      steps: draft.actions.length,
      health: automationHealth(Boolean(a.enabled), summary),
      rate: summary.successRate,
      runs30: summary.executed,
      buckets: dailyBuckets(rs, STATS_DAYS, nowMs),
      errors: analysis.counts.error,
      warnings: analysis.counts.warning,
    };
  });
  const attention = items.filter((a) => a.health === "failing" || a.health === "attention" || a.errors > 0).length;
  const successRate = executed30 ? Math.round(((success30 ?? 0) / executed30) * 100) : null;

  return (
    <>
      <PageHeader
        title={t("automations.title")}
        description={t("automations.subtitle")}
        actions={
          <Link href={`/${locale}/automations/new`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-medium text-accent-fg hover:bg-accent-solid-hover">
            <Plus className="h-4 w-4" /> {t("automations.new")}
          </Link>
        }
      />

      {list.length > 0 ? (
        <section aria-label={it("o.kpiTotal")} className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="automation-kpis">
          <KpiTile icon={<Layers className="h-4 w-4" />} label={it("o.kpiTotal")} value={formatNumber(locale, list.length)} />
          <KpiTile icon={<PlayCircle className="h-4 w-4" />} label={it("o.kpiActive")} value={formatNumber(locale, items.filter((a) => a.enabled).length)} tone="accent" />
          <KpiTile icon={<Activity className="h-4 w-4" />} label={it("o.kpiRuns")} value={formatNumber(locale, executed30 ?? 0)} />
          <KpiTile icon={<CheckCircle2 className="h-4 w-4" />} label={it("o.kpiSuccess")} value={successRate == null ? "—" : `${successRate}%`} tone={successRate == null ? "neutral" : successRate >= 85 ? "success" : successRate >= 50 ? "warning" : "danger"} />
          <KpiTile icon={<ShieldAlert className="h-4 w-4" />} label={it("o.kpiAttention")} value={formatNumber(locale, attention)} tone={attention > 0 ? "warning" : "success"} />
        </section>
      ) : null}

      {(dead ?? 0) > 0 ? (
        <Card className="mb-4 flex items-center gap-3 border-danger/30 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
          <span>
            {t("automations.deadJobs", { count: dead ?? 0 })}
            <span className="mt-0.5 block text-[12px] text-muted">{it("o.deadHint")}</span>
          </span>
        </Card>
      ) : null}

      {list.length === 0 ? (
        <>
          <RecipeGallery recommended={["welcomeLead", "dealWon", "inboundLead"]} />
          <Card className="mb-4">
            <EmptyState icon={<Workflow className="h-6 w-6" />} title={t("automations.empty")} body={t("automations.emptyBody")} />
          </Card>
        </>
      ) : (
        <>
          <AutomationListView items={items} />
          <RecipeGallery />
        </>
      )}

      <Card>
        <CardHeader title={t("automations.recentRuns")} description={queued ? t("automations.queued", { count: queued }) : undefined} />
        {(runs ?? []).length === 0 ? (
          <p className="p-5 text-center text-sm text-subtle">{t("automations.noRuns")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(runs ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={RUN_TONE[r.status as string] ?? "neutral"}>{t(`automations.runStatus.${r.status}`)}</Badge>
                <Link href={`/${locale}/automations/${r.automation_id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                  {nameOf.get(r.automation_id as string) ?? "—"}
                </Link>
                <span className="text-[12px] text-subtle">{formatDateTime(locale, r.created_at as string)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
