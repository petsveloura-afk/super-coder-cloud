import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { randomBytes } from "node:crypto";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { FormBuilder } from "@/components/forms/form-builder";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("forms.new") };
}

export default async function NewFormPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("forms.manage")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/forms`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("forms.pageTitle")}
      </Link>
      <PageHeader title={t("forms.new")} />
      <FormBuilder
        initial={{
          name: t("forms.defaultName"),
          slug: `form-${randomBytes(3).toString("hex")}`,
          status: "active",
          fields: [
            { key: "name", label: t("forms.presets.name"), type: "text", required: true },
            { key: "email", label: t("forms.presets.email"), type: "email", required: true },
            { key: "phone", label: t("forms.presets.phone"), type: "phone", required: false },
            { key: "message", label: t("forms.presets.message"), type: "textarea", required: false },
          ],
          settings: { notify: true },
        }}
      />
    </>
  );
}
