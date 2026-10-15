import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { requireUser } from "@/lib/auth";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("auth.updatePassword") };
}

/** Reached via the recovery link (/auth/confirm establishes a short-lived session first). */
export default async function ResetPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  await requireUser(locale);
  const { t } = await getT(locale);
  return (
    <AuthCard title={t("auth.updatePassword")}>
      <ResetPasswordForm />
    </AuthCard>
  );
}
