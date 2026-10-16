"use client";

import { useI18n } from "@/lib/i18n/client";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { deleteAutomationAction } from "@/app/[locale]/(dashboard)/automations/actions";

export function DeleteAutomationButton({ id }: { id: string }) {
  const { locale } = useI18n();
  return <ConfirmActionButton action={deleteAutomationAction} fields={{ id }} redirectTo={`/${locale}/automations`} />;
}
