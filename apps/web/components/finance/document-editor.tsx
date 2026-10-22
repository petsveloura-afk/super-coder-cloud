"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { documentTotals } from "@scc/shared/engagement";
import { CURRENCIES } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveDocumentAction } from "@/app/[locale]/(dashboard)/finance/actions";
import { formatCurrency } from "@/lib/format";

export interface LineValue {
  description: string;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  tax_rate: string;
}
export interface DocumentValue {
  kind: "quote" | "invoice";
  title: string;
  contactId: string;
  companyId: string;
  dealId: string;
  issue_date: string;
  due_date: string;
  currency: string;
  notes: string;
  payment_url: string;
  lines: LineValue[];
  /** wave 15: contract (quotes) */
  require_signature?: boolean;
  contract_terms?: string;
}
interface Option {
  id: string;
  label: string;
}
interface Product {
  id: string;
  name: string;
  description: string | null;
  unit_price: number;
  tax_rate: number | null;
}

export function DocumentEditor({
  id,
  initial,
  contacts,
  companies,
  deals,
  products,
  defaultTax,
}: {
  id?: string;
  initial: DocumentValue;
  contacts: Option[];
  companies: Option[];
  deals: Option[];
  products: Product[];
  defaultTax: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<DocumentValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, start] = useTransition();
  const set = (patch: Partial<DocumentValue>) => setV((x) => ({ ...x, ...patch }));
  const setLine = (i: number, patch: Partial<LineValue>) => setV((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const emptyLine = (): LineValue => ({ description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: String(defaultTax) });
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);
  const totals = useMemo(
    () => documentTotals(v.lines.map((l) => ({ quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_rate: Number(l.tax_rate) }))),
    [v.lines],
  );
  const money = (n: number) => formatCurrency(locale, n, v.currency || "ILS");

  function addProduct(pid: string) {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    const line: LineValue = { description: p.description ? `${p.name} — ${p.description}` : p.name, quantity: "1", unit_price: String(p.unit_price), discount_pct: "0", tax_rate: String(p.tax_rate ?? defaultTax) };
    setV((x) => ({ ...x, lines: x.lines.length === 1 && !x.lines[0]!.description ? [line] : [...x.lines, line] }));
  }

  function save() {
    setErrors({});
    start(async () => {
      const res = await saveDocumentAction({ locale, id, data: v });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.fieldErrors?.lines ? res.fieldErrors.lines : res.error));
        return;
      }
      toast.success(t(res.message ?? "common.saved"));
      if (!id && res.data?.id) router.push(`/${locale}/finance/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("finance.docTitle")} htmlFor="doc-title" error={err("title")} className="sm:col-span-2">
          <Input id="doc-title" value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("finance.docTitlePlaceholder")} />
        </Field>
        <Field label={t("finance.customer")} htmlFor="doc-contact" error={err("contactId")}>
          <Select id="doc-contact" value={v.contactId} onChange={(e) => set({ contactId: e.target.value })}>
            <option value="">{t("common.none")}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("finance.company")} htmlFor="doc-company">
          <Select id="doc-company" value={v.companyId} onChange={(e) => set({ companyId: e.target.value })}>
            <option value="">{t("common.none")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("finance.deal")} htmlFor="doc-deal">
          <Select id="doc-deal" value={v.dealId} onChange={(e) => set({ dealId: e.target.value })}>
            <option value="">{t("common.none")}</option>
            {deals.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("finance.currency")} htmlFor="doc-currency">
          <Select id="doc-currency" value={v.currency} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("finance.issueDate")} htmlFor="doc-issue" error={err("issue_date")}>
          <Input id="doc-issue" type="date" value={v.issue_date} onChange={(e) => set({ issue_date: e.target.value })} />
        </Field>
        <Field label={t(v.kind === "quote" ? "finance.validUntil" : "finance.dueDate")} htmlFor="doc-due" error={err("due_date")}>
          <Input id="doc-due" type="date" value={v.due_date} onChange={(e) => set({ due_date: e.target.value })} />
        </Field>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t("finance.lines")}</h2>
          {products.length ? (
            <Select aria-label={t("finance.addProduct")} value="" onChange={(e) => addProduct(e.target.value)} className="w-auto">
              <option value="">{t("finance.addProduct")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatCurrency(locale, Number(p.unit_price), v.currency || "ILS")}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        <ol className="space-y-3">
          {v.lines.map((l, i) => {
            const lt = documentTotals([{ quantity: Number(l.quantity), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct), tax_rate: 0 }]).subtotal;
            return (
              <li key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_90px_120px_90px_90px_auto]" data-line={i}>
                <Field label={t("finance.description")} htmlFor={`ln-${i}-desc`} error={err(`lines.${i}.description`)}>
                  <Input id={`ln-${i}-desc`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                </Field>
                <Field label={t("finance.quantity")} htmlFor={`ln-${i}-qty`} error={err(`lines.${i}.quantity`)}>
                  <Input id={`ln-${i}-qty`} inputMode="decimal" dir="ltr" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </Field>
                <Field label={t("finance.unitPrice")} htmlFor={`ln-${i}-price`} error={err(`lines.${i}.unit_price`)}>
                  <Input id={`ln-${i}-price`} inputMode="decimal" dir="ltr" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                </Field>
                <Field label={t("finance.discount")} htmlFor={`ln-${i}-disc`} error={err(`lines.${i}.discount_pct`)}>
                  <Input id={`ln-${i}-disc`} inputMode="decimal" dir="ltr" value={l.discount_pct} onChange={(e) => setLine(i, { discount_pct: e.target.value })} />
                </Field>
                <Field label={t("finance.taxRate")} htmlFor={`ln-${i}-tax`} error={err(`lines.${i}.tax_rate`)}>
                  <Input id={`ln-${i}-tax`} inputMode="decimal" dir="ltr" value={l.tax_rate} onChange={(e) => setLine(i, { tax_rate: e.target.value })} />
                </Field>
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="text-sm font-medium tabular-nums" data-line-total>
                    {money(lt)}
                  </span>
                  <Button variant="ghost" size="sm" aria-label={t("common.delete")} disabled={v.lines.length === 1} onClick={() => setV((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setV((x) => ({ ...x, lines: [...x.lines, emptyLine()] }))}>
          <Plus className="h-4 w-4" /> {t("finance.addLine")}
        </Button>
        <dl className="ms-auto mt-5 max-w-xs space-y-1 text-sm" aria-live="polite">
          <div className="flex justify-between">
            <dt className="text-muted">{t("finance.subtotal")}</dt>
            <dd className="tabular-nums">{money(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("finance.tax")}</dt>
            <dd className="tabular-nums">{money(totals.tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-base font-bold">
            <dt>{t("finance.total")}</dt>
            <dd className="tabular-nums" data-testid="doc-total">
              {money(totals.total)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="grid gap-4 p-5">
        <Field label={t("finance.notes")} htmlFor="doc-notes" error={err("notes")}>
          <Textarea id="doc-notes" rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <Field label={t("finance.paymentUrl")} htmlFor="doc-payurl" error={err("payment_url")} hint={t("finance.paymentUrlHint")}>
          <Input id="doc-payurl" dir="ltr" value={v.payment_url} onChange={(e) => set({ payment_url: e.target.value })} placeholder="https://" />
        </Field>
      </Card>

      {v.kind === "quote" ? (
        <Card className="grid gap-3 p-5" data-testid="contract-card">
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input type="checkbox" checked={Boolean(v.require_signature)} onChange={(e) => set({ require_signature: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" data-testid="require-signature" />
            <span className="flex items-center gap-2 font-semibold">
              <PenLine className="h-4 w-4 text-accent" /> {t("contract.require")}
            </span>
          </label>
          <p className="text-[12.5px] text-muted">{t("contract.requireHint")}</p>
          {v.require_signature ? (
            <Field label={t("contract.terms")} htmlFor="doc-terms" error={err("contract_terms")} hint={t("contract.termsHint")}>
              <Textarea id="doc-terms" rows={8} value={v.contract_terms ?? ""} onChange={(e) => set({ contract_terms: e.target.value })} placeholder={t("contract.termsPlaceholder")} />
            </Field>
          ) : null}
        </Card>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" /> {t("finance.saveDraft")}
        </Button>
      </div>
    </div>
  );
}
