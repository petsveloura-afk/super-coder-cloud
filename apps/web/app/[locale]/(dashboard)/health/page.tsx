import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MissionControlView } from "@/components/ops/mission-control";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("ops.title") };
}

/** Spec A1 — Mission Control: everything that is connected, what failed and what needs action, in one screen. */
export default async function HealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("settings.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <Card>
        <EmptyState title={t("ops.title")} body={t("errors.generic")} />
      </Card>
    );
  }
  const { loadMissionControl } = await import("@/lib/ops/system");
  const data = await loadMissionControl(ctx.org.id, ctx.isPlatformAdmin);
  return (
    <>
      <PageHeader title={t("ops.title")} description={t("ops.subtitle")} />
      <MissionControlView data={data} />
    </>
  );
}
