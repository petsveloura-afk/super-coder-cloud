"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { mfaDisableAction, mfaEnrollAction, mfaStatusAction, mfaVerifyAction, signOutOthersAction } from "@/app/[locale]/(dashboard)/settings/security-actions";

/** Spec I1 / I2 — two-step sign-in with an authenticator app, and "sign out of all other devices". */
export function SecurityCard() {
  const { t, locale } = useI18n();
  const [factors, setFactors] = useState<{ id: string; name: string | null; created_at: string }[] | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const refresh = () => void mfaStatusAction().then((r) => setFactors(r.data?.factors ?? []));
  useEffect(() => {
    let alive = true;
    void mfaStatusAction().then((r) => {
      if (alive) setFactors(r.data?.factors ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);
  const on = (factors?.length ?? 0) > 0;
  return (
    <div className="space-y-4 p-5" data-testid="security-card">
      <div className="flex flex-wrap items-center gap-2">
        {on ? <ShieldCheck className="h-5 w-5 text-success" /> : <ShieldOff className="h-5 w-5 text-subtle" />}
        <p className="font-semibold">{t("security.mfaTitle")}</p>
        <Badge tone={on ? "success" : "neutral"}>{t(on ? "security.on" : "security.off")}</Badge>
      </div>
      <p className="text-[13px] text-muted">{t("security.mfaBody")}</p>
      {enroll ? (
        <div className="grid gap-4 rounded-2xl border border-line p-4 sm:grid-cols-[180px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt={t("security.qrAlt")} className="h-44 w-44 rounded-xl bg-white p-2" />
          <div className="space-y-2 text-[13px]">
            <p>{t("security.scan")}</p>
            <p className="text-[12px] text-muted">
              {t("security.orCode")} <bdi dir="ltr" className="break-all font-mono text-fg">{enroll.secret}</bdi>
            </p>
            <label className="block space-y-1">
              <span className="text-[12.5px] font-medium text-muted">{t("security.codeLabel")}</span>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="w-36 text-center tracking-[0.3em]" placeholder="123456" />
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={code.length !== 6} loading={pending} onClick={() => start(async () => { const r = await mfaVerifyAction({ locale, factorId: enroll.factorId, code }); if (r.error) return void toast.error(t(r.error)); toast.success(t(r.message ?? "security.enabled")); setEnroll(null); setCode(""); refresh(); })}>
                {t("security.confirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEnroll(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      ) : on ? (
        <ul className="space-y-2">
          {factors!.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-[13px]">
              <KeyRound className="h-4 w-4 text-accent" />
              <span className="flex-1">{f.name ?? t("security.app")}</span>
              <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => start(async () => { const r = await mfaDisableAction({ locale, factorId: f.id }); if (r.error) return void toast.error(t(r.error)); toast.success(t(r.message ?? "common.saved")); refresh(); })}>
                {t("security.disable")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Button size="sm" loading={pending} disabled={factors === null} onClick={() => start(async () => { const r = await mfaEnrollAction({ locale }); if (r.error || !r.data) return void toast.error(t(r.error ?? "security.enrollFailed")); setEnroll(r.data); })} data-testid="mfa-enable">
          <ShieldCheck className="h-4 w-4" /> {t("security.enable")}
        </Button>
      )}
      <div className="border-t border-line pt-4">
        <p className="font-semibold">{t("security.sessionsTitle")}</p>
        <p className="mt-1 text-[13px] text-muted">{t("security.sessionsBody")}</p>
        <Button size="sm" variant="secondary" className="mt-2" disabled={pending} onClick={() => start(async () => { const r = await signOutOthersAction({ locale }); if (r.error) toast.error(t(r.error)); else toast.success(t(r.message ?? "security.othersOut")); })}>
          <LogOut className="h-4 w-4 rtl:-scale-x-100" /> {t("security.signOutOthers")}
        </Button>
      </div>
    </div>
  );
}
