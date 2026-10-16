"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, FileOutput, Pencil, Plus, Printer, Send, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHODS } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import {
  convertToInvoiceAction,
  deleteDocumentAction,
  deletePaymentAction,
  deleteProductAction,
  recordPaymentAction,
  saveFinanceSettingsAction,
  saveProductAction,
  sendDocumentAction,
  setDocumentStatusAction,
} from "@/app/[locale]/(dashboard)/finance/actions";

/* --------------------------------------------------------- document bar */
export function DocumentActions({
  id,
  kind,
  status,
  publicUrl,
  balance,
}: {
  id: string;
  kind: "quote" | "invoice";
  status: string;
  publicUrl: string;
  balance: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [converting, startConvert] = useTransition();
  const [sending, startSend] = useTransition();
  const fd = (extra: Record<string, string>) => {
    const f = new FormData();
    f.set("locale", locale);
    f.set("id", id);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" || status === "sent" ? (
        <Button
          loading={sending}
          onClick={() =>
            startSend(async () => {
              const r = await sendDocumentAction(fd({}));
              if (r.error) toast.error(t(r.error));
              else {
                toast.success(t(r.message ?? "common.saved"));
                router.refresh();
              }
            })
          }
        >
          <Send className="h-4 w-4" /> {t(status === "draft" ? "finance.send" : "finance.resend")}
        </Button>
      ) : null}
      {status !== "draft" ? (
        <>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(publicUrl);
                toast.success(t("common.copied"));
              } catch {
                toast.error(t("common.error"));
              }
            }}
          >
            <Copy className="h-4 w-4" /> {t("finance.copyLink")}
          </Button>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-hover">
            <Printer className="h-4 w-4" /> {t("finance.viewPrint")}
          </a>
        </>
      ) : null}
      {kind === "quote" && status === "sent" ? (
        <>
          <ConfirmActionButton action={setDocumentStatusAction} fields={{ id, status: "accepted" }} label={t("finance.markAccepted")} variant="secondary" confirm={false} icon={<CheckCircle2 className="h-4 w-4" />} />
          <ConfirmActionButton action={setDocumentStatusAction} fields={{ id, status: "declined" }} label={t("finance.markDeclined")} variant="ghost" confirm={false} />
        </>
      ) : null}
      {kind === "quote" && status !== "draft" && status !== "void" ? (
        <Button
          variant="secondary"
          loading={converting}
          onClick={() =>
            startConvert(async () => {
              const r = await convertToInvoiceAction(fd({}));
              if (r.error) toast.error(t(r.error));
              else if (r.data?.id) {
                toast.success(t(r.message ?? "common.saved"));
                router.push(`/${locale}/finance/${r.data.id}`);
              }
            })
          }
        >
          <FileOutput className="h-4 w-4" /> {t("finance.convertToInvoice")}
        </Button>
      ) : null}
      {kind === "invoice" && ["sent", "accepted"].includes(status) && balance > 0 ? <PaymentButton documentId={id} balance={balance} /> : null}
      {status !== "draft" && status !== "void" && status !== "paid" ? (
        <ConfirmActionButton action={setDocumentStatusAction} fields={{ id, status: "void" }} label={t("finance.void")} variant="ghost" confirm={t("finance.voidConfirm")} />
      ) : null}
      {status === "void" || status === "declined" ? (
        <ConfirmActionButton action={setDocumentStatusAction} fields={{ id, status: "draft" }} label={t("finance.backToDraft")} variant="ghost" confirm={false} icon={<Pencil className="h-4 w-4" />} />
      ) : null}
      {status === "draft" ? <ConfirmActionButton action={deleteDocumentAction} fields={{ id }} label={t("common.delete")} redirectTo={`/${locale}/finance`} /> : null}
    </div>
  );
}

export function PaymentButton({ documentId, balance }: { documentId: string; balance: number }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={recordPaymentAction}
      title={t("finance.recordPayment")}
      hidden={{ documentId }}
      trigger={
        <Button variant="secondary">
          <Wallet className="h-4 w-4" /> {t("finance.recordPayment")}
        </Button>
      }
    >
      {(state) => <PaymentFields state={state} balance={balance} />}
    </FormDialog>
  );
}

function PaymentFields({ state, balance }: { state: { values?: Record<string, string>; fieldErrors?: Record<string, string> }; balance: number }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("finance.amount")} htmlFor="pay-amount" error={err("amount")}>
        <Input id="pay-amount" name="amount" inputMode="decimal" dir="ltr" defaultValue={state.values?.amount ?? String(balance)} />
      </Field>
      <Field label={t("finance.method")} htmlFor="pay-method" error={err("method")}>
        <Select id="pay-method" name="method" defaultValue={state.values?.method ?? "transfer"}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`finance.methods.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.paidAt")} htmlFor="pay-date" error={err("paid_at")}>
        <Input id="pay-date" name="paid_at" type="date" defaultValue={state.values?.paid_at ?? new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label={t("finance.reference")} htmlFor="pay-ref" error={err("reference")}>
        <Input id="pay-ref" name="reference" defaultValue={state.values?.reference ?? ""} />
      </Field>
    </div>
  );
}

export function DeletePaymentButton({ id }: { id: string }) {
  const { t } = useI18n();
  return <ConfirmActionButton action={deletePaymentAction} fields={{ id }} size="sm" variant="ghost" label={t("common.delete")} />;
}

/* ------------------------------------------------------------- products */
interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  tax_rate: number | null;
}

export function ProductButton({ product }: { product?: ProductRow }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={saveProductAction}
      title={t(product ? "finance.editProduct" : "finance.newProduct")}
      hidden={{ id: product?.id }}
      trigger={
        product ? (
          <Button variant="ghost" size="sm" aria-label={t("common.edit")}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> {t("finance.newProduct")}
          </Button>
        )
      }
      footer={product ? <ConfirmActionButton action={deleteProductAction} fields={{ id: product.id }} label={t("common.delete")} /> : undefined}
    >
      {(state) => <ProductFields state={state} product={product} />}
    </FormDialog>
  );
}

function ProductFields({ state, product }: { state: { values?: Record<string, string>; fieldErrors?: Record<string, string> }; product?: ProductRow }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const val = (k: keyof ProductRow) => state.values?.[k] ?? (product?.[k] == null ? "" : String(product[k]));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("finance.productName")} htmlFor="pr-name" error={err("name")} className="sm:col-span-2">
        <Input id="pr-name" name="name" defaultValue={val("name")} required />
      </Field>
      <Field label={t("finance.unitPrice")} htmlFor="pr-price" error={err("unit_price")}>
        <Input id="pr-price" name="unit_price" inputMode="decimal" dir="ltr" defaultValue={val("unit_price") || "0"} />
      </Field>
      <Field label={t("finance.taxRate")} htmlFor="pr-tax" error={err("tax_rate")} hint={t("finance.taxDefaultHint")}>
        <Input id="pr-tax" name="tax_rate" inputMode="decimal" dir="ltr" defaultValue={val("tax_rate")} />
      </Field>
      <Field label={t("finance.description")} htmlFor="pr-desc" error={err("description")} className="sm:col-span-2">
        <Textarea id="pr-desc" name="description" rows={2} defaultValue={val("description")} />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------- settings */
export interface FinanceSettingsValue {
  business_name: string;
  business_id: string;
  address: string;
  phone: string;
  email: string;
  default_tax_rate: string;
  quote_valid_days: string;
  payment_terms_days: string;
  payment_instructions: string;
  default_notes: string;
}

export function FinanceSettingsForm({ initial, stripeReady, webhookUrl }: { initial: FinanceSettingsValue; stripeReady: boolean; webhookUrl: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);
  const text = (k: keyof FinanceSettingsValue, label: string, extra?: { dir?: "ltr"; type?: string }) => (
    <Field label={t(label)} htmlFor={`fs-${k}`} error={err(k)}>
      <Input id={`fs-${k}`} name={k} defaultValue={initial[k]} dir={extra?.dir} type={extra?.type} />
    </Field>
  );
  return (
    <form
      noValidate
      className="space-y-5"
      action={(fd) => {
        fd.set("locale", locale);
        setErrors({});
        start(async () => {
          const r = await saveFinanceSettingsAction({}, fd);
          if (r.error || r.fieldErrors) {
            setErrors(r.fieldErrors ?? {});
            toast.error(t(r.error ?? "common.error"));
            return;
          }
          toast.success(t(r.message ?? "common.saved"));
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("business_name", "finance.businessName")}
        {text("business_id", "finance.businessId", { dir: "ltr" })}
        {text("address", "finance.address")}
        {text("phone", "finance.phone", { dir: "ltr" })}
        {text("email", "finance.email", { dir: "ltr", type: "email" })}
        {text("default_tax_rate", "finance.defaultTax", { dir: "ltr" })}
        {text("quote_valid_days", "finance.quoteValidDays", { dir: "ltr" })}
        {text("payment_terms_days", "finance.paymentTermsDays", { dir: "ltr" })}
      </div>
      <Field label={t("finance.paymentInstructions")} htmlFor="fs-payment_instructions" error={err("payment_instructions")}>
        <Textarea id="fs-payment_instructions" name="payment_instructions" rows={3} defaultValue={initial.payment_instructions} />
      </Field>
      <Field label={t("finance.defaultNotes")} htmlFor="fs-default_notes" error={err("default_notes")}>
        <Textarea id="fs-default_notes" name="default_notes" rows={3} defaultValue={initial.default_notes} />
      </Field>

      <fieldset className="space-y-4 rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">{t("finance.onlinePayments")}</legend>
        <p className="text-[13px] text-muted">{t(stripeReady ? "finance.stripeConnected" : "finance.stripeHint")}</p>
        {webhookUrl ? (
          <div className="space-y-1">
            <p className="text-[12.5px] text-muted">{t("finance.webhookUrlLabel")}</p>
            <code dir="ltr" className="block break-all rounded-lg bg-elevated px-3 py-2 text-[12px]" data-testid="finance-webhook-url">
              {webhookUrl}
            </code>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("finance.stripeSecret")} htmlFor="fs-stripe_secret_key" error={err("stripe_secret_key")} hint={stripeReady ? t("finance.keepSecretHint") : undefined}>
            <Input id="fs-stripe_secret_key" name="stripe_secret_key" type="password" autoComplete="off" dir="ltr" placeholder="sk_live_…" />
          </Field>
          <Field label={t("finance.stripeWebhookSecret")} htmlFor="fs-stripe_webhook_secret" error={err("stripe_webhook_secret")}>
            <Input id="fs-stripe_webhook_secret" name="stripe_webhook_secret" type="password" autoComplete="off" dir="ltr" placeholder="whsec_…" />
          </Field>
        </div>
        {stripeReady ? (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="stripe_disconnect" /> {t("finance.stripeDisconnect")}
          </label>
        ) : null}
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
