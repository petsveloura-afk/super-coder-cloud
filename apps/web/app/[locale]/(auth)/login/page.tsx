import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard, Divider } from "@/components/auth/auth-card";
import { GoogleButton, SignInForm } from "@/components/auth/auth-forms";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { publicEnv, safeRedirectPath } from "@/lib/env";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("auth.signIn") };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  const sp = await searchParams;
  const next = safeRedirectPath(sp.next, "") || undefined;
  return (
    <AuthCard
      title={t("auth.signInTitle")}
      subtitle={t("auth.signInSubtitle")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link href={`/${locale}/signup`} className="font-medium text-accent hover:underline">
            {t("auth.signUp")}
          </Link>
        </>
      }
    >
      {publicEnv.googleAuthEnabled ? (
        <>
          <GoogleButton />
          <Divider label={t("auth.or")} />
        </>
      ) : null}
      <SignInForm next={next} linkError={sp.error === "link" || sp.error === "oauth"} />
    </AuthCard>
  );
}
