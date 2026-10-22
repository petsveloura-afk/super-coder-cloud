"use client";

import { useTransition } from "react";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { callWithAgentAction } from "@/app/[locale]/(dashboard)/crm/insight-actions";

/** Wave 16 — "the AI agent calls the customer now". */
export function AgentCallButton({ contactId }: { contactId: string }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      data-testid="agent-call"
      onClick={() => {
        if (!window.confirm(t("voice.confirmCall"))) return;
        start(async () => {
          const r = await callWithAgentAction({ locale, contactId });
          if (r.error) toast.error(t(r.error));
          else toast.success(t(r.message ?? "voice.calling"));
        });
      }}
    >
      <PhoneCall className="h-4 w-4" /> <span className="hidden sm:inline">{t("voice.callButton")}</span>
    </Button>
  );
}
