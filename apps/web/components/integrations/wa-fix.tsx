"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { registerWhatsAppAction } from "@/app/[locale]/(dashboard)/integrations/whatsapp-actions";

/**
 * Wave 60 — one button that checks the official WhatsApp number with Meta and fixes it (registers it on the
 * Cloud API). When Meta needs the number's existing two-step PIN, a 6-digit box appears.
 */
export function WhatsAppFix({ problem }: { problem: boolean }) {
  const { t, locale } = useI18n();
  const [pin, setPin] = useState("");
  const [askPin, setAskPin] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await registerWhatsAppAction({ locale, pin: askPin ? pin : undefined });
      if (r.error) {
        if (r.error === "integrations.wa.needPin") setAskPin(true);
        return void toast.error(t(r.error));
      }
      toast.success(t(r.message ?? "integrations.wa.registeredOk"));
      setAskPin(false);
    });
  return (
    <div className={problem ? "mt-3 rounded-2xl border border-warning/40 bg-warning-soft/40 p-3" : "mt-2"} id="wa-fix" data-testid="wa-fix">
      {problem ? <p className="mb-2 text-[13px] font-semibold text-warning">{t("integrations.wa.notRegistered")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {askPin ? (
          <>
            <label htmlFor="wa-pin" className="sr-only">
              {t("integrations.wa.pinLabel")}
            </label>
            <Input id="wa-pin" dir="ltr" inputMode="numeric" maxLength={6} placeholder="123456" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="w-32 text-center tracking-[0.3em]" />
          </>
        ) : null}
        <Button size="sm" variant={problem ? "primary" : "ghost"} loading={pending} disabled={askPin && pin.length !== 6} onClick={run} data-testid="wa-fix-run">
          {problem ? <Wrench className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} {t(problem ? "integrations.wa.fixNow" : "integrations.wa.checkNow")}
        </Button>
      </div>
      {askPin ? <p className="mt-1.5 text-[12px] text-muted">{t("integrations.wa.pinHint")}</p> : null}
    </div>
  );
}
