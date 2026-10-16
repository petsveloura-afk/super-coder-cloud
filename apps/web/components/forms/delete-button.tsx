"use client";

import { useI18n } from "@/lib/i18n/client";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { deleteFormAction } from "@/app/[locale]/(dashboard)/forms/actions";

export function DeleteFormButton({ id }: { id: string }) {
  const { locale, t } = useI18n();
  return <ConfirmActionButton action={deleteFormAction} fields={{ id }} redirectTo={`/${locale}/forms`} confirm={t("forms.confirmDelete")} />;
}
