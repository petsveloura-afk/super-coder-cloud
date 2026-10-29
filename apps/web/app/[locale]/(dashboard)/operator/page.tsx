import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { OperatorClient, type HistoryRow } from "@/components/operator/operator-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { FeatureLock, TrialNote } from "@/components/billing/feature-gate";
import { featureAccess } from "@/lib/billing/features";

/** wave 55: planning may need the full failover chain (several engines) — allow up to 60s */
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("operator.title") };
}

/** Wave 54 — the AI Operator page: instruction → plan → approve → done, plus the person's recent runs. */
export default async function OperatorPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const [{ data: org }, runsRes] = await Promise.all([
    supabase.from("organizations").select("timezone").eq("id", ctx.org.id).maybeSingle(),
    supabase.from("operator_runs").select("id, instruction, status, created_at, plan").eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(12),
  ]);
  const history: HistoryRow[] = ((runsRes.error ? [] : runsRes.data) ?? []).map((r) => ({
    id: r.id as string,
    instruction: String(r.instruction ?? ""),
    status: String(r.status ?? "planned"),
    created_at: r.created_at as string,
    count: Array.isArray((r.plan as { actions?: unknown[] } | null)?.actions) ? ((r.plan as { actions: unknown[] }).actions.length) : 0,
  }));
  // wave 55: the AI Operator is a paid feature (Pro) with a 7-day free trial
  const access = await featureAccess(ctx.org.id, "ai_operator");
  if (!access.allowed) {
    return (
      <>
        <PageHeader title={t("operator.title")} description={t("operator.subtitle")} />
        <FeatureLock locale={locale} feature="ai_operator" plan="pro" access={access} canTrial={ctx.can("billing.manage") || ctx.can("ai.manage")} />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("operator.title")} description={t("operator.subtitle")} />
      <TrialNote locale={locale} access={access} />
      <OperatorClient history={history} timeZone={((org as { timezone?: string } | null)?.timezone as string | undefined) || DEFAULT_TIME_ZONE} />
    </>
  );
}
