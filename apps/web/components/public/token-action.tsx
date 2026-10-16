"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { cancelPublicAppointment, unsubscribePublic } from "@/app/[locale]/(public)/actions";

/** Confirm-by-click page for links in e-mails (never acts on a plain GET / link preview). */
export function TokenAction({ kind, token }: { kind: "cancel" | "unsubscribe"; token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const [pending, start] = useTransition();
  return (
    <div className="rounded-3xl border border-line bg-surface p-8 text-center">
      {state === "done" ? (
        <>
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
          <p role="status" className="mt-4 text-lg font-semibold">{t(kind === "cancel" ? "booking.canceled" : "public.unsubscribed")}</p>
        </>
      ) : state === "failed" ? (
        <>
          <XCircle className="mx-auto h-12 w-12 text-danger" />
          <p role="alert" className="mt-4 text-lg font-semibold">{t(kind === "cancel" ? "booking.cancelFailed" : "public.unsubscribeFailed")}</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold">{t(kind === "cancel" ? "booking.cancelTitle" : "public.unsubscribeTitle")}</h1>
          <Button
            className="mt-6"
            variant={kind === "cancel" ? "danger" : "primary"}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = kind === "cancel" ? await cancelPublicAppointment(token) : await unsubscribePublic(token);
                setState(r.ok ? "done" : "failed");
              })
            }
          >
            {t(kind === "cancel" ? "booking.cancelConfirm" : "public.unsubscribeConfirm")}
          </Button>
        </>
      )}
    </div>
  );
}
