"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, ExternalLink, LifeBuoy, ShieldCheck, Stethoscope, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { diagnosisAdvice, type DiagRow } from "@/lib/channels/wa-register-core";
import { diagnoseWhatsAppAction, registerWhatsAppAction } from "@/app/[locale]/(dashboard)/integrations/whatsapp-actions";

/**
 * Wave 60 — one button that checks the official WhatsApp number with Meta and fixes it (registers it on the
 * Cloud API). When Meta needs the number's existing two-step PIN, a 6-digit box appears.
 * Wave 61 — Meta's exact reason in plain words, a "what does Meta say" diagnosis of the number, and a clear
 * guide for the Meta screen that gets stuck ("cannot onboard customers right now") — with the QR connection
 * keeping WhatsApp working in the meantime.
 */
const META_LINKS = [
  { key: "verify", href: "https://business.facebook.com/settings/security" },
  { key: "techProvider", href: "https://developers.facebook.com/apps/" },
  { key: "manager", href: "https://business.facebook.com/wa/manage/phone-numbers/" },
] as const;

export function WhatsAppFix({ problem, qrConnected = false }: { problem: boolean; qrConnected?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [askPin, setAskPin] = useState(false);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<DiagRow[] | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const run = () =>
    start(async () => {
      const r = await registerWhatsAppAction({ locale, pin: askPin ? pin : undefined });
      if (r.error) {
        if (r.error === "integrations.wa.needPin") setAskPin(true);
        setLastError(t(r.error, r.messageParams));
        if (r.error !== "integrations.wa.needPin") setHelp(true);
        return void toast.error(t(r.error, r.messageParams));
      }
      toast.success(t(r.message ?? "integrations.wa.registeredOk"));
      setAskPin(false);
      setLastError(null);
      router.refresh();
    });
  const diagnose = () =>
    start(async () => {
      const r = await diagnoseWhatsAppAction({ locale });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "integrations.wa.diagFailed", r.messageParams));
      setRows(r.data.rows);
    });
  const advice = rows ? diagnosisAdvice(rows) : null;
  return (
    <div className={problem ? "mt-3 rounded-2xl border border-warning/40 bg-warning-soft/40 p-3" : "mt-2"} id="wa-fix" data-testid="wa-fix">
      {problem ? <p className="mb-2 text-[13px] font-semibold text-warning">{t("integrations.wa.notRegistered")}</p> : null}
      {problem && qrConnected ? <p className="mb-2 text-[12.5px] text-success">{t("integrations.wa.qrKeepsWorking")}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {askPin ? (
          <>
            <label htmlFor="wa-pin" className="sr-only">
              {t("integrations.wa.pinLabel")}
            </label>
            <Input id="wa-pin" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="w-32 text-center tracking-[0.3em]" />
          </>
        ) : null}
        <Button size="sm" variant={problem ? "primary" : "ghost"} loading={pending} disabled={askPin && pin.length !== 6} onClick={run} data-testid="wa-fix-run">
          {problem ? <Wrench className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} {t(problem ? "integrations.wa.fixNow" : "integrations.wa.checkNow")}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={diagnose} data-testid="wa-diagnose">
          <Stethoscope className="h-4 w-4" aria-hidden /> {t("integrations.wa.diagnose")}
        </Button>
        {problem ? (
          <Button size="sm" variant="ghost" onClick={() => setHelp((x) => !x)} aria-expanded={help}>
            <LifeBuoy className="h-4 w-4" aria-hidden /> {t("integrations.wa.stuckTitle")}
          </Button>
        ) : null}
      </div>
      {askPin ? <p className="mt-1.5 text-[12px] text-muted">{t("integrations.wa.pinHint")}</p> : null}
      {lastError ? <p className="mt-2 text-[12px] text-danger">{lastError}</p> : null}
      {rows ? (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3" data-testid="wa-diagnosis">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-1.5 text-[12.5px]">
                {r.ok === true ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : r.ok === false ? <CircleAlert className="h-4 w-4 shrink-0 text-danger" /> : <CircleDashed className="h-4 w-4 shrink-0 text-subtle" />}
                <span className="text-muted">{t(`integrations.wa.diag.${r.key}`)}:</span>
                <bdi dir="ltr" className="truncate font-medium">
                  {r.value}
                </bdi>
              </li>
            ))}
          </ul>
          {advice ? <p className="mt-2 text-[12.5px] font-medium">{t(advice)}</p> : rows.every((r) => r.ok !== false) ? <p className="mt-2 text-[12.5px] text-success">{t("integrations.wa.advice.allGood")}</p> : null}
        </div>
      ) : null}
      {help ? (
        <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface p-3 text-[12.5px]" data-testid="wa-stuck-help">
          <p className="font-semibold">{t("integrations.wa.stuckTitle")}</p>
          <p className="text-muted">{t("integrations.wa.stuckBody")}</p>
          <ol className="list-decimal space-y-1 ps-5">
            {META_LINKS.map((l) => (
              <li key={l.key}>
                {t(`integrations.wa.stuck.${l.key}`)}{" "}
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline">
                  {t("integrations.wa.open")} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
            <li>{t("integrations.wa.stuck.retry")}</li>
          </ol>
          <p className="text-success">{t(qrConnected ? "integrations.wa.qrKeepsWorking" : "integrations.wa.stuckQr")}</p>
        </div>
      ) : null}
    </div>
  );
}
