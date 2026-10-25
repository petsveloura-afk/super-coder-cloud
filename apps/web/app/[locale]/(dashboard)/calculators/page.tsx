import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { CalculatorsClient } from "@/components/calculators/calculators-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("calculators.title") };
}

/** Wave 24 — business calculators for every member (no data leaves the browser). */
export default async function CalculatorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  return (
    <>
      <PageHeader title={t("calculators.title")} description={t("calculators.subtitle")} />
      <CalculatorsClient currency={ctx.org.currency || "ILS"} />
    </>
  );
}
