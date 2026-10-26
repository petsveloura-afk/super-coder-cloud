"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { cancelCampaignAction, deleteCampaignAction, duplicateCampaignAction } from "@/app/[locale]/(dashboard)/campaigns/actions";

/** Wave 26 — one click: a fresh draft copy of this campaign (message, audience, template), opened for editing. */
function DuplicateButton({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      data-testid="campaign-duplicate"
      onClick={async () => {
        setPending(true);
        try {
          const fd = new FormData();
          fd.set("id", id);
          fd.set("locale", locale);
          const res = await duplicateCampaignAction(fd);
          if ("error" in res && res.error) toast.error(t(res.error));
          else if (res.ok && res.data?.id) {
            toast.success(t("campaigns.duplicated"));
            router.push(`/${locale}/campaigns/${res.data.id}`);
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <Copy className="h-4 w-4" /> {t("campaigns.duplicate")}
    </Button>
  );
}

export function CampaignActions({ id, status }: { id: string; status: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
      <DuplicateButton id={id} />
      {["scheduled", "sending"].includes(status) ? <ConfirmActionButton action={cancelCampaignAction} fields={{ id }} variant="secondary" icon={<span />} label={t("campaigns.cancel")} confirm={t("campaigns.confirmCancel")} /> : null}
      {["draft", "canceled", "sent"].includes(status) ? <ConfirmActionButton action={deleteCampaignAction} fields={{ id }} redirectTo={`/${locale}/campaigns`} /> : null}
    </div>
  );
}
