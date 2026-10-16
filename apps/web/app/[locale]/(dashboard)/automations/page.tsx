import Link from "next/link";
import { triggerLabel } from "@/lib/labels";
import type { Metadata } from "next";
import { AlertTriangle, Plus, Sparkles, Workflow } from "lucide-react";
import { AUTOMATION_RECIPES } from "@scc/shared/automations";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AutomationToggle } from "@/components/automations/list-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("automations.title") };
}

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { success: "success", partial: "warning", failed: "danger", skipped: "neutral" };

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
  const [{ data: automations }, { data: runs }, { count: dead }, { count: queued }] = await Promise.all([
    supabase.from("automations").select("id, name, description, enabled, trigger_type, run_count, last_run_at").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }),
    supabase.from("automation_runs").select("id, automation_id, status, created_at, error").eq("organization_id", ctx.org.id).neq("status", "skipped").order("created_at", { ascending: false }).limit(15),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "dead"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "queued"),
  ]);
  const list = automations ?? [];
  const nameOf = new Map(list.map((a) => [a.id as string, a.name as string]));

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

      {(dead ?? 0) > 0 ? (
        <Card className="mb-4 flex items-center gap-3 border-danger/30 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
          <span>{t("automations.deadJobs", { count: dead ?? 0 })}</span>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader title={t("automations.templates")} description={t("automations.templatesHint")} />
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {AUTOMATION_RECIPES.map((r) => (
            <li key={r.key}>
              <Link href={`/${locale}/automations/new?recipe=${r.key}`} className="flex h-full flex-col gap-1.5 rounded-xl border border-line p-4 transition-colors hover:border-accent hover:bg-surface-hover">
                <span className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-4 w-4 text-gold" /> {t(`automations.recipes.${r.key}.name`)}
                </span>
                <span className="text-[12.5px] text-muted">{t(`automations.recipes.${r.key}.body`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Workflow className="h-6 w-6" />} title={t("automations.empty")} body={t("automations.emptyBody")} />
        </Card>
      ) : (
        <Card className="mb-4 overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
                <Link href={`/${locale}/automations/${a.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold hover:text-accent">{a.name}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">
                    {triggerLabel(t, a.trigger_type as string)} · {t("automations.runs", { count: formatNumber(locale, Number(a.run_count)) })}
                    {a.last_run_at ? ` · ${formatDateTime(locale, a.last_run_at as string)}` : ""}
                  </span>
                </Link>
                <AutomationToggle id={a.id as string} enabled={Boolean(a.enabled)} />
              </li>
            ))}
          </ul>
        </Card>
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
