import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard, Divider } from "@/components/auth/auth-card";
import { GoogleButton, SignUpForm } from "@/components/auth/auth-forms";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { publicEnv } from "@/lib/env";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("auth.signUp") };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  return (
    <AuthCard
      title={t("auth.signUpTitle")}
      subtitle={t("auth.signUpSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link href={`/${locale}/login`} className="font-medium text-accent hover:underline">
            {t("auth.signIn")}
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
      <SignUpForm />
    </AuthCard>
  );
}
