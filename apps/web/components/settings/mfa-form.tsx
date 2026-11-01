"use client";

import { useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { mfaLoginAction } from "@/app/[locale]/(dashboard)/settings/security-actions";

export function MfaForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await mfaLoginAction({ code });
      if (r.error) return setErr(r.error);
      window.location.assign(next);
    });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) submit();
      }}
      data-testid="mfa-form"
    >
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium text-muted">{t("security.codeLabel")}</span>
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus dir="ltr" className="text-center text-lg tracking-[0.4em]" placeholder="123456" />
      </label>
      {err ? <p className="text-[13px] text-danger" role="alert">{t(err)}</p> : null}
      <Button type="submit" size="lg" className="w-full justify-center" loading={pending} disabled={code.length !== 6}>
        {t("security.verify")}
      </Button>
    </form>
  );
}
