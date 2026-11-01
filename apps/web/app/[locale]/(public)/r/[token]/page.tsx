import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";
import { SurveyForm } from "@/components/surveys/survey-form";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { scaleEnds, scaleValues, surveyQuestion, type SurveyKind } from "@/lib/surveys-core";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("surveys.pageTitle"), robots: { index: false } };
}

/** Spec D4 — the customer's one-click survey page (no login; the token is the only key). */
export default async function SurveyPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const { t } = await getT(locale);
  const supabase = await createClient();
  const { data } = /^[a-f0-9]{16,64}$/i.test(token) ? await supabase.rpc("survey_by_token", { p_token: token }) : { data: null };
  const row = (Array.isArray(data) ? data[0] : data) as { kind: SurveyKind; status: string; org_name: string; question: string | null } | undefined;
  if (!row) {
    return (
      <Card className="p-6 text-center">
        <p className="font-semibold">{t("surveys.notFound")}</p>
      </Card>
    );
  }
  if (row.status === "answered") {
    return (
      <Card className="p-6 text-center">
        <p className="text-3xl">🙏</p>
        <p className="mt-2 font-semibold">{t("surveys.alreadyAnswered")}</p>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <p className="text-[12.5px] font-semibold uppercase tracking-wide text-subtle">{row.org_name}</p>
      <h1 className="mt-1 text-xl font-bold" dir="auto">
        {surveyQuestion(row.kind, locale, row.question)}
      </h1>
      <SurveyForm token={token} values={scaleValues(row.kind)} ends={scaleEnds(row.kind, locale)} />
    </Card>
  );
}
