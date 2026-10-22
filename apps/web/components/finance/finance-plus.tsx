"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, CreditCard, FileCheck2, Link2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/action-state";
import { createPaymentLinkAction, issueTaxDocAction, saveInvoicingAction, saveOrgPayPalAction } from "@/app/[locale]/(dashboard)/finance/plus-actions";

function useToastOnOk(state: ActionState<unknown>) {
  const { t } = useI18n();
  const router = useRouter();
  const seen = useRef<ActionState<unknown> | null>(null);
  useEffect(() => {
    if (state.ok && seen.current !== state) {
      seen.current = state;
      toast.success(t(state.message ?? "common.saved"));
      router.refresh();
    }
  }, [state, t, router]);
}

/** Wave 15 — "issue tax document" for one payment (Morning / iCount). */
export function IssueTaxDocButton({ paymentId, provider }: { paymentId: string; provider: string }) {
  const { t } = useI18n();
  return <ConfirmActionButton action={issueTaxDocAction} fields={{ paymentId }} confirm={false} variant="ghost" size="sm" icon={<Receipt className="h-4 w-4" />} label={t("invoicing.issueNow", { provider: t(`invoicing.providers.${provider}`) })} />;
}

/** The business's own PayPal: customers pay invoices by card (no PayPal account) or PayPal. */
export function OrgPayPalCard({ connected, mode }: { connected: boolean; mode: string }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(saveOrgPayPalAction, {} as ActionState);
  useToastOnOk(state);
  const shown = state.ok ? ({} as ActionState) : state;
  return (
    <form action={action} className="space-y-4" data-testid="org-paypal">
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CreditCard className="h-4 w-4 text-accent" /> {t("orgPaypal.title")}
        </h2>
        {connected ? <Badge tone="success">{t("orgPaypal.connectedBadge", { mode: t(`orgPaypal.modes.${mode}`) })}</Badge> : <Badge>{t("orgPaypal.notConnected")}</Badge>}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">{t("orgPaypal.hint")}</p>
      <FormAlert state={shown} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("orgPaypal.clientId")} htmlFor="pp-client" error={shown.fieldErrors?.client_id ? t(shown.fieldErrors.client_id) : undefined}>
          <Input id="pp-client" name="client_id" dir="ltr" autoComplete="off" placeholder="AYx…" />
        </Field>
        <Field label={t("orgPaypal.secret")} htmlFor="pp-secret" error={shown.fieldErrors?.secret ? t(shown.fieldErrors.secret) : undefined} hint={connected ? t("finance.keepSecretHint") : undefined}>
          <Input id="pp-secret" name="secret" type="password" dir="ltr" autoComplete="off" placeholder="E…" />
        </Field>
        <Field label={t("orgPaypal.mode")} htmlFor="pp-mode">
          <Select id="pp-mode" name="mode" defaultValue={mode}>
            <option value="live">{t("orgPaypal.modes.live")}</option>
            <option value="sandbox">{t("orgPaypal.modes.sandbox")}</option>
          </Select>
        </Field>
      </div>
      <ol className="list-decimal space-y-1 ps-5 text-[12.5px] text-muted">
        <li>{t("orgPaypal.step1")}</li>
        <li>{t("orgPaypal.step2")}</li>
        <li>{t("orgPaypal.step3")}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{t(connected ? "orgPaypal.update" : "orgPaypal.connect")}</SubmitButton>
        {connected ? (
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" name="disconnect" /> {t("orgPaypal.disconnect")}
          </label>
        ) : null}
      </div>
    </form>
  );
}

/** Morning / iCount: a legal tax document for every payment, automatically. */
export function InvoicingCard({ provider, config, lastError, lastSuccess, locked }: { provider: string | null; config: Record<string, unknown>; lastError: string | null; lastSuccess: string | null; locked: boolean }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(saveInvoicingAction, {} as ActionState);
  const [p, setP] = useState(provider ?? "morning");
  useToastOnOk(state);
  const shown = state.ok ? ({} as ActionState) : state;
  return (
    <form action={action} className="space-y-4" data-testid="invoicing-card">
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <FileCheck2 className="h-4 w-4 text-accent" /> {t("invoicing.title")}
        </h2>
        {provider ? <Badge tone={lastError ? "warning" : "success"}>{t("invoicing.connectedTo", { provider: t(`invoicing.providers.${provider}`) })}</Badge> : <Badge>{t("invoicing.none")}</Badge>}
      </div>
      <p className="text-[13px] leading-relaxed text-muted">{t("invoicing.hint")}</p>
      {locked ? <p className="rounded-xl border border-gold/30 bg-gold-soft p-3 text-[13px]">{t("plans.locked.invoicing_sync.body", { plan: t("billing.plans.pro.name") })}</p> : null}
      {lastError ? <p className="text-[12.5px] text-danger">{t("invoicing.lastError", { error: lastError.slice(0, 160) })}</p> : lastSuccess ? <p className="flex items-center gap-1 text-[12.5px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> {t("invoicing.working")}</p> : null}
      <FormAlert state={shown} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("invoicing.provider")} htmlFor="inv-provider">
          <Select id="inv-provider" name="provider" value={p} onChange={(e) => setP(e.target.value)}>
            <option value="morning">{t("invoicing.providers.morning")}</option>
            <option value="icount">{t("invoicing.providers.icount")}</option>
          </Select>
        </Field>
        <Field label={t("invoicing.docType")} htmlFor="inv-type">
          <Select id="inv-type" name="doc_type" defaultValue={(config.doc_type as string | undefined) ?? "invoice_receipt"}>
            <option value="invoice_receipt">{t("invoicing.types.invoice_receipt")}</option>
            <option value="receipt">{t("invoicing.types.receipt")}</option>
          </Select>
        </Field>
        {p === "morning" ? (
          <>
            <Field label={t("invoicing.keyId")} htmlFor="inv-kid" error={shown.fieldErrors?.key_id ? t(shown.fieldErrors.key_id) : undefined} hint={provider === "morning" ? t("finance.keepSecretHint") : undefined}>
              <Input id="inv-kid" name="key_id" dir="ltr" autoComplete="off" />
            </Field>
            <Field label={t("invoicing.keySecret")} htmlFor="inv-ksec">
              <Input id="inv-ksec" name="key_secret" type="password" dir="ltr" autoComplete="off" />
            </Field>
          </>
        ) : (
          <Field label={t("invoicing.apiToken")} htmlFor="inv-token" error={shown.fieldErrors?.api_token ? t(shown.fieldErrors.api_token) : undefined} hint={provider === "icount" ? t("finance.keepSecretHint") : undefined} className="sm:col-span-2">
            <Input id="inv-token" name="api_token" type="password" dir="ltr" autoComplete="off" placeholder="API3E8-…" />
          </Field>
        )}
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="auto" defaultChecked={config.auto !== false} className="h-4 w-4 accent-[var(--brand)]" /> {t("invoicing.auto")}
        </label>
        {p === "morning" ? (
          <label className="flex items-center gap-2 text-muted">
            <input type="checkbox" name="sandbox" defaultChecked={config.sandbox === true} className="h-4 w-4 accent-[var(--brand)]" /> {t("invoicing.sandbox")}
          </label>
        ) : null}
      </div>
      <p className="text-[12px] text-subtle">{t(p === "morning" ? "invoicing.whereMorning" : "invoicing.whereIcount")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={locked}>{t(provider ? "invoicing.update" : "invoicing.connect")}</SubmitButton>
        {provider ? (
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" name="disconnect" /> {t("invoicing.disconnect")}
          </label>
        ) : null}
      </div>
    </form>
  );
}

/** Inbox: send the customer a payment link (an invoice + its link in the chat). */
export function PaymentLinkButton({ conversationId, currency }: { conversationId: string; currency: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [vatIncluded, setVatIncluded] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setUrl(null);
      }}
      title={t("payLink.title")}
      description={t("payLink.subtitle")}
      trigger={
        <Button variant="ghost" size="sm" data-testid="pay-link-button" title={t("payLink.title")}>
          <Link2 className="h-4 w-4" /> <span className="hidden sm:inline">{t("payLink.button")}</span>
        </Button>
      }
    >
      {url ? (
        <div className="space-y-3" data-testid="pay-link-done">
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> {t("payLink.sent")}
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-elevated p-2">
            <bdi dir="ltr" className="min-w-0 flex-1 truncate text-[13px]">
              {url}
            </bdi>
            <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success(t("notify.copied")))}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            start(async () => {
              const r = await createPaymentLinkAction({ locale, conversationId, amount, description, currency, vatIncluded });
              if (r.error) {
                setErrors(r.fieldErrors ?? {});
                toast.error(t(r.error));
                return;
              }
              toast.success(t(r.message ?? "payLink.sent"));
              setUrl(r.data?.url ?? null);
              router.refresh();
            });
          }}
        >
          <Field label={t("payLink.description")} htmlFor="pl-desc" error={errors.description ? t(errors.description) : undefined}>
            <Input id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("payLink.descriptionPlaceholder")} />
          </Field>
          <Field label={t("payLink.amount", { currency })} htmlFor="pl-amount" error={errors.amount ? t(errors.amount) : undefined}>
            <Input id="pl-amount" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" /> {t("payLink.vatIncluded")}
          </label>
          <p className="text-[12px] text-subtle">{t("payLink.hint")}</p>
          <Button type="submit" loading={pending} className="w-full justify-center">
            <Link2 className="h-4 w-4" /> {t("payLink.create")}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
