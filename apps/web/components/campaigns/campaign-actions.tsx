"use client";

import { useI18n } from "@/lib/i18n/client";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { cancelCampaignAction, deleteCampaignAction } from "@/app/[locale]/(dashboard)/campaigns/actions";

export function CampaignActions({ id, status }: { id: string; status: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex gap-2">
      {["scheduled", "sending"].includes(status) ? <ConfirmActionButton action={cancelCampaignAction} fields={{ id }} variant="secondary" icon={<span />} label={t("campaigns.cancel")} confirm={t("campaigns.confirmCancel")} /> : null}
      {["draft", "canceled", "sent"].includes(status) ? <ConfirmActionButton action={deleteCampaignAction} fields={{ id }} redirectTo={`/${locale}/campaigns`} /> : null}
    </div>
  );
}
