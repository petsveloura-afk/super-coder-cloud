import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Network } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { loadTeamPageData } from "@/lib/team/page-data";
import { FlagEnable } from "@/components/ai-team/flag-enable";
import { FeatureLock, TrialNote } from "@/components/billing/feature-gate";
import { featureAccess } from "@/lib/billing/features";

// the team screen is heavy (3D presentation, editor, panels) — loaded as its own chunk
const TeamScreen = dynamic(() => import("@/components/ai-team/team-screen").then((m) => m.TeamScreen), { loading: () => <div className="skeleton h-[480px] rounded-[32px]" aria-hidden /> });

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("aiTeam.title") };
}

// a task started from this screen ("run now") may take a while — give the server action the same room as the team clock
export const maxDuration = 60;

/** The digital team ("My team"). Behind the feature flag team_v1 — without it the page explains and changes nothing. */
export default async function AiTeamPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const runner = await import("@/lib/team/runner");
  const flag = process.env.SUPABASE_SERVICE_ROLE_KEY ? await runner.teamFlagOn(ctx.org.id) : false;
  if (!flag) {
    return (
      <>
        <PageHeader title={t("aiTeam.title")} description={t("aiTeam.subtitle")} />
        <Card>
          <EmptyState icon={<Network className="h-6 w-6" />} title={t("aiTeam.flagOff.title")} body={t("aiTeam.flagOff.body")} action={ctx.isPlatformAdmin ? <FlagEnable /> : undefined} />
        </Card>
      </>
    );
  }

  // paid feature: the existing "ai_team" plan feature (Pro and up) with its 7-day free trial — without it, the lock + trial
  const access = await featureAccess(ctx.org.id, "ai_team");
  const canTrial = ctx.can("billing.manage") || ctx.can("ai.manage");
  if (!access.allowed) {
    return (
      <>
        <PageHeader title={t("aiTeam.title")} description={t("aiTeam.subtitle")} />
        <FeatureLock locale={locale} feature="ai_team" plan="pro" access={access} canTrial={canTrial} />
        {ctx.isPlatformAdmin ? <Card className="mt-4"><EmptyState icon={<Network className="h-6 w-6" />} title={t("aiTeam.planLocked.adminTitle")} body={t("aiTeam.planLocked.adminBody")} /></Card> : null}
      </>
    );
  }

  const data = await loadTeamPageData(ctx.org.id, { canManage: ctx.can("ai.manage"), platformAdmin: ctx.isPlatformAdmin });

  return (
    <>
      <PageHeader title={t("aiTeam.title")} description={t("aiTeam.subtitle")} />
      <TrialNote locale={locale} access={access} />
      <TeamScreen data={data} />
    </>
  );
}
