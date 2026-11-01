import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Network } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { loadTeamPageData } from "@/lib/team/page-data";
import { FlagEnable } from "@/components/ai-team/flag-enable";

// the team screen is heavy (3D presentation, editor, panels) — loaded as its own chunk
const TeamScreen = dynamic(() => import("@/components/ai-team/team-screen").then((m) => m.TeamScreen), { loading: () => <div className="skeleton h-[480px] rounded-[32px]" aria-hidden /> });

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("aiTeam.title") };
}

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

  const data = await loadTeamPageData(ctx.org.id, { canManage: ctx.can("ai.manage"), platformAdmin: ctx.isPlatformAdmin });

  return (
    <>
      <PageHeader title={t("aiTeam.title")} description={t("aiTeam.subtitle")} />
      <TeamScreen data={data} />
    </>
  );
}
