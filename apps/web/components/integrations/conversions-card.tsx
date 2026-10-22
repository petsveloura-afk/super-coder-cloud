"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Target } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Card, Field, Input, Select } from "@/components/ui/primitives";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/action-state";
import { saveConversionsAction, testConversionAction } from "@/app/[locale]/(dashboard)/integrations/growth-actions";

export interface ConversionConn {
  status: string;
  config: Record<string, unknown>;
  last_success_at: string | null;
  last_error: string | null;
}

const PROVIDERS = ["meta_capi", "ga4", "tiktok"] as const;
type P = (typeof PROVIDERS)[number];

/** Wave 17 — server-side conversions to Meta / Google Analytics 4 / TikTok. */
export function ConversionsCard({ conns, locked }: { conns: Partial<Record<P, ConversionConn>>; locked: boolean }) {
  const { t, locale } = useI18n();
  const [p, setP] = useState<P>((PROVIDERS.find((x) => conns[x]) ?? "meta_capi") as P);
  const [state, action] = useActionState(saveConversionsAction, {} as ActionState);
  const [testState, testAction] = useActionState(testConversionAction, {} as ActionState);
  const c = conns[p];
  const cfg = c?.config ?? {};
  const events = Array.isArray(cfg.events) ? (cfg.events as string[]) : ["Lead", "Schedule", "Purchase"];
  return (
    <Card className="mb-4 space-y-4 p-5" data-testid="conversions-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Target className="h-4 w-4 text-accent" /> {t("conversions.title")}
        </h2>
        {PROVIDERS.filter((x) => conns[x]).map((x) => (
          <Badge key={x} tone={conns[x]?.last_error ? "warning" : "success"}>
            {t(`conversions.providers.${x}`)}
          </Badge>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">{t("conversions.hint")}</p>
      {locked ? <p className="rounded-xl border border-gold/30 bg-gold-soft p-3 text-[13px]">{t("plans.locked.conversion_api.title")}</p> : null}
      <Field label={t("conversions.provider")} htmlFor="cv-provider" className="max-w-xs">
        <Select id="cv-provider" value={p} onChange={(e) => setP(e.target.value as P)}>
          {PROVIDERS.map((x) => (
            <option key={x} value={x}>
              {t(`conversions.providers.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      {c?.last_error ? <p className="text-[12.5px] text-danger">{t("conversions.lastError", { error: c.last_error.slice(0, 160) })}</p> : c?.last_success_at ? <p className="flex items-center gap-1 text-[12.5px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> {t("conversions.working")}</p> : null}
      <form action={action} key={p} className="space-y-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="provider" value={p} />
        <FormAlert state={state} />
        <div className="grid gap-3 sm:grid-cols-2">
          {p === "meta_capi" ? (
            <Field label={t("conversions.pixelId")} htmlFor="cv-id">
              <Input id="cv-id" name="pixel_id" dir="ltr" inputMode="numeric" defaultValue={String(cfg.pixel_id ?? "")} placeholder="123456789012345" />
            </Field>
          ) : p === "ga4" ? (
            <Field label={t("conversions.measurementId")} htmlFor="cv-id">
              <Input id="cv-id" name="measurement_id" dir="ltr" defaultValue={String(cfg.measurement_id ?? "")} placeholder="G-XXXXXXXXXX" />
            </Field>
          ) : (
            <Field label={t("conversions.pixelCode")} htmlFor="cv-id">
              <Input id="cv-id" name="pixel_code" dir="ltr" defaultValue={String(cfg.pixel_code ?? "")} placeholder="C123ABC456DEF" />
            </Field>
          )}
          <Field label={t(p === "ga4" ? "conversions.apiSecret" : "conversions.accessToken")} htmlFor="cv-secret" hint={c ? t("finance.keepSecretHint") : undefined}>
            <Input id="cv-secret" name="secret" type="password" dir="ltr" autoComplete="off" />
          </Field>
          {p !== "ga4" ? (
            <Field label={t("conversions.testCode")} htmlFor="cv-test" hint={t("conversions.testCodeHint")}>
              <Input id="cv-test" name="test_code" dir="ltr" defaultValue={String(cfg.test_code ?? "")} placeholder="TEST12345" />
            </Field>
          ) : null}
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <legend className="mb-1 text-[13px] font-medium text-muted">{t("conversions.events")}</legend>
          {(["Lead", "Schedule", "Purchase"] as const).map((e) => (
            <label key={e} className="flex items-center gap-2">
              <input type="checkbox" name={`ev_${e}`} defaultChecked={events.includes(e)} className="h-4 w-4 accent-[var(--brand)]" /> {t(`conversions.ev.${e}`)}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="require_consent" defaultChecked={cfg.require_consent !== false} className="h-4 w-4 accent-[var(--brand)]" /> {t("conversions.requireConsent")}
        </label>
        <p className="text-[12px] text-subtle">{t(`conversions.where.${p}`)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={locked}>{t(c ? "conversions.update" : "conversions.connect")}</SubmitButton>
          {c ? (
            <label className="flex items-center gap-2 text-[13px] text-danger">
              <input type="checkbox" name="disconnect" className="h-4 w-4" /> {t("conversions.disconnect")}
            </label>
          ) : null}
        </div>
      </form>
      {c ? (
        <form action={testAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="provider" value={p} />
          <SubmitButton variant="secondary">{t("conversions.test")}</SubmitButton>
          <FormAlert state={testState} />
        </form>
      ) : null}
    </Card>
  );
}
