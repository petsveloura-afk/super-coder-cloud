import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { MfaForm } from "@/components/settings/mfa-form";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { safeRedirectPath } from "@/lib/env";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("security.loginTitle") };
}

/** Spec I1 — the second sign-in step: the 6-digit code from the authenticator app. */
export default async function MfaPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  const sp = await searchParams;
  const next = safeRedirectPath(typeof sp.next === "string" ? sp.next : null, `/${locale}/overview`);
  return (
    <AuthCard title={t("security.loginTitle")} subtitle={t("security.loginBody")}>
      <MfaForm next={next} />
    </AuthCard>
  );
}
