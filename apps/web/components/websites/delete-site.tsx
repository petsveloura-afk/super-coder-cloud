"use client";

import { useI18n } from "@/lib/i18n/client";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { deleteSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";

export function ConfirmDeleteSite({ id, redirectTo }: { id: string; redirectTo?: string }) {
  const { t } = useI18n();
  return <ConfirmActionButton action={deleteSiteAction} fields={{ id }} size="sm" label={t("common.delete")} redirectTo={redirectTo} />;
}
