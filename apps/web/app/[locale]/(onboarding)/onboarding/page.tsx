import type { Metadata } from "next";
import { BrandLockup } from "@/components/layout/brand";
import { LanguageSwitcher, ThemeToggle } from "@/components/layout/locale-theme";
import { Card } from "@/components/ui/primitives";
import { CreateOrgForm, JoinOrgForm } from "@/components/onboarding/onboarding-forms";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("onboarding.title") };
}

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const locale = await resolveLocale(params);
  await requireUser(locale);
  const { t } = await getT(locale);
  const { invite } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <BrandLockup />
        <div className="flex items-center gap-1">
          <LanguageSwitcher className="hidden sm:flex" />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-4xl flex-1 gap-5 px-4 pb-10 pt-4 lg:grid-cols-[1.4fr_1fr] lg:items-start lg:pt-12">
        <Card className="glass p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("onboarding.title")}</h1>
          <p className="mt-1.5 text-sm text-muted">{t("onboarding.subtitle")}</p>
          <div className="mt-6">
            <CreateOrgForm />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-base font-semibold">{t("onboarding.joinTitle")}</h2>
          <p className="mb-4 mt-1 text-sm text-muted">{t("onboarding.joinBody")}</p>
          <JoinOrgForm defaultToken={invite?.slice(0, 200)} />
        </Card>
      </main>
    </div>
  );
}
