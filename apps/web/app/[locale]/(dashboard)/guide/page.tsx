import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { GuideViewer } from "@/components/guide/guide-viewer";
import { WhatsNew } from "@/components/guide/whats-new";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";

/** Wave 23 — the user guide inside the app (every signed-in member; no permission needed). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("guide.title") };
}

export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  await getOrgContext(locale);
  const { t } = await getT(locale);
  return (
    <>
      <PageHeader title={t("guide.title")} description={t("guide.subtitle")} />
      {locale !== "he" ? <p className="-mt-3 mb-4 text-[13px] text-subtle">{t("guide.onlyHebrew")}</p> : null}
      {/* wave 57: what's new (waves 51–57), animated — the screenshot guide below is unchanged */}
      <WhatsNew />
      <GuideViewer />
    </>
  );
}
