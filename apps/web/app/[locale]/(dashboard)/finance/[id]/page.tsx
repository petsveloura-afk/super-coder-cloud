import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/finance/document-editor";
import { DeletePaymentButton, DocumentActions } from "@/components/finance/finance-client";
import { IssueTaxDocButton } from "@/components/finance/finance-plus";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { financeEditorData } from "@/lib/finance/editor-data";
import { DOC_STATUS_TONE } from "@/lib/finance/labels";
import { publicEnv } from "@/lib/env";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("finance.title") };
}

export default async function DocumentPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const locale = await resolveLocale(params);
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("finance.read")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const supabase = await createClient();
  const { data: d } = await supabase.from("documents").select("*").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!d) notFound();
  const [{ data: lines }, { data: payments }, { data: source }, { data: derived }] = await Promise.all([
    supabase.from("document_lines").select("description, quantity, unit_price, discount_pct, tax_rate, line_total").eq("document_id", id).order("position"),
    supabase.from("payments").select("id, amount, method, reference, paid_at, external_id, invoice_ref").eq("document_id", id).order("paid_at"),
    d.source_document_id ? supabase.from("documents").select("id, kind, number").eq("id", d.source_document_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("documents").select("id, kind, number").eq("source_document_id", id).limit(5),
  ]);
  const canWrite = ctx.can("finance.write");
  const editable = canWrite && d.status === "draft";
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const kind = d.kind as "quote" | "invoice";
  const money = (n: number) => formatCurrency(locale, n, d.currency as string);
  const balance = Math.round((Number(d.total) - Number(d.amount_paid)) * 100) / 100;
  const publicUrl = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/q/${d.public_token}`;
  const editor = editable ? await financeEditorData(ctx.org.id) : null;
  // wave 15: is an invoicing service (Morning / iCount) connected? → "issue tax document" per payment
  const { data: invoicing } = kind === "invoice" ? await supabase.from("integrations").select("provider, status").eq("organization_id", ctx.org.id).in("provider", ["morning", "icount"]).eq("status", "active").limit(1) : { data: [] };
  const invoicingProvider = ((invoicing ?? [])[0]?.provider as string | undefined) ?? null;

  return (
    <>
      <Link href={`/${locale}/finance`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("finance.title")}
      </Link>
      <PageHeader title={`${t(`finance.kindShort.${kind}`)} #${d.number}`} description={(d.title as string | null) ?? t("finance.notTaxInvoice")} actions={<Badge tone={DOC_STATUS_TONE[d.status as string] ?? "neutral"}>{t(`finance.statuses.${d.status}`)}</Badge>} />
      {canWrite ? (
        <Card className="mb-4 p-3">
          <DocumentActions id={id} kind={kind} status={d.status as string} publicUrl={publicUrl} balance={balance} />
        </Card>
      ) : null}
      {source || (derived ?? []).length ? (
        <Card className="mb-4 flex flex-wrap gap-3 p-3 text-[13px]">
          {source ? (
            <Link href={`/${locale}/finance/${source.id}`} className="text-accent hover:underline">
              {t("finance.createdFrom")} {t(`finance.kindShort.${source.kind}`)} #{source.number as number}
            </Link>
          ) : null}
          {(derived ?? []).map((x) => (
            <Link key={x.id as string} href={`/${locale}/finance/${x.id}`} className="text-accent hover:underline">
              → {t(`finance.kindShort.${x.kind}`)} #{x.number as number}
            </Link>
          ))}
        </Card>
      ) : null}

      {editable && editor ? (
        <DocumentEditor
          id={id}
          contacts={editor.contacts}
          companies={editor.companies}
          deals={editor.deals}
          products={editor.products}
          defaultTax={editor.defaultTax}
          initial={{
            kind,
            title: (d.title as string | null) ?? "",
            contactId: (d.contact_id as string | null) ?? "",
            companyId: (d.company_id as string | null) ?? "",
            dealId: (d.deal_id as string | null) ?? "",
            issue_date: d.issue_date as string,
            due_date: (d.due_date as string | null) ?? "",
            currency: d.currency as string,
            notes: (d.notes as string | null) ?? "",
            payment_url: (d.payment_url as string | null) ?? "",
            require_signature: Boolean(d.require_signature),
            contract_terms: (d.contract_terms as string | null) ?? "",
            lines: (lines ?? []).map((l) => ({ description: l.description as string, quantity: String(l.quantity), unit_price: String(l.unit_price), discount_pct: String(l.discount_pct), tax_rate: String(l.tax_rate) })),
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="overflow-x-auto p-5">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 text-start font-medium">{t("finance.description")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.quantity")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.unitPrice")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.discount")}</th>
                  <th className="py-2 text-end font-medium">{t("finance.lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {(lines ?? []).map((l, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="py-2">{l.description as string}</td>
                    <td className="py-2 text-end tabular-nums">{Number(l.quantity)}</td>
                    <td className="py-2 text-end tabular-nums">{money(Number(l.unit_price))}</td>
                    <td className="py-2 text-end tabular-nums">{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : "—"}</td>
                    <td className="py-2 text-end tabular-nums">{money(Number(l.line_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ms-auto mt-4 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t("finance.subtotal")}</dt>
                <dd className="tabular-nums">{money(Number(d.subtotal))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("finance.tax")}</dt>
                <dd className="tabular-nums">{money(Number(d.tax_total))}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1 text-base font-bold">
                <dt>{t("finance.total")}</dt>
                <dd className="tabular-nums" data-testid="doc-total">
                  {money(Number(d.total))}
                </dd>
              </div>
              {kind === "invoice" ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted">{t("finance.paid")}</dt>
                    <dd className="tabular-nums">{money(Number(d.amount_paid))}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>{t("finance.balance")}</dt>
                    <dd className="tabular-nums" data-testid="doc-balance">
                      {money(Math.max(0, balance))}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
            {d.notes ? <p className="mt-4 whitespace-pre-wrap text-[13px] text-muted">{d.notes as string}</p> : null}
            {d.contract_terms ? (
              <div className="mt-5 rounded-xl border border-line p-4" data-testid="contract-terms">
                <h3 className="mb-2 text-sm font-semibold">{t("contract.terms")}</h3>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{d.contract_terms as string}</p>
              </div>
            ) : null}
            {d.signed_at ? (
              <div className="mt-4 rounded-xl border border-success/30 bg-success-soft p-4" data-testid="signature-block">
                <p className="text-sm font-semibold text-success">{t("contract.signedBy", { name: (d.accepted_by_name as string | null) ?? "—", date: formatDateTime(locale, d.signed_at as string) })}</p>
                {d.signature_data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.signature_data as string} alt={t("contract.signatureAlt")} className="mt-2 h-20 max-w-full rounded-lg bg-white p-1" />
                ) : null}
                {d.content_hash ? (
                  <p className="mt-2 break-all text-[11px] text-muted">
                    {t("contract.hash")}: <bdi dir="ltr" className="font-mono">{d.content_hash as string}</bdi>
                  </p>
                ) : null}
              </div>
            ) : d.require_signature ? (
              <p className="mt-4 text-[13px] text-muted">✍️ {t("contract.awaiting")}</p>
            ) : null}
          </Card>
          <div className="space-y-4">
            <Card className="space-y-2 p-4 text-[13px]">
              <p>
                <span className="text-muted">{t("finance.issueDate")}: </span>
                {formatDate(locale, d.issue_date as string)}
              </p>
              {d.due_date ? (
                <p>
                  <span className="text-muted">{t(kind === "quote" ? "finance.validUntil" : "finance.dueDate")}: </span>
                  {formatDate(locale, d.due_date as string)}
                </p>
              ) : null}
              {d.sent_at ? (
                <p>
                  <span className="text-muted">{t("finance.sentAt")}: </span>
                  {formatDateTime(locale, d.sent_at as string)}
                </p>
              ) : null}
              {Number(d.view_count ?? 0) > 0 ? (
                <p data-testid="doc-views">
                  <span className="text-muted">{t("contract.views")}: </span>
                  {Number(d.view_count)} · {t("contract.firstView")} {d.viewed_at ? formatDateTime(locale, d.viewed_at as string) : "—"}
                </p>
              ) : d.status !== "draft" ? (
                <p className="text-subtle">{t("contract.notViewed")}</p>
              ) : null}
              {d.accepted_at ? (
                <p>
                  <span className="text-muted">{t("finance.acceptedBy")}: </span>
                  {(d.accepted_by_name as string | null) ?? "—"} · {formatDateTime(locale, d.accepted_at as string)}
                </p>
              ) : null}
              {d.contact_id ? (
                <Link href={`/${locale}/crm/${d.contact_id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                  {t("finance.openCustomer")} <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </Card>
            {kind === "invoice" ? (
              <Card className="p-4">
                <h2 className="mb-2 font-semibold">{t("finance.payments")}</h2>
                {(payments ?? []).length === 0 ? (
                  <p className="text-[13px] text-subtle">{t("finance.noPayments")}</p>
                ) : (
                  <ul className="divide-y divide-line text-[13px]">
                    {(payments ?? []).map((p) => (
                      <li key={p.id as string} className="flex items-center gap-2 py-2" data-payment>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium tabular-nums">{money(Number(p.amount))}</p>
                          <p className="truncate text-subtle">
                            {t(`finance.methods.${p.method}`)} · {formatDate(locale, p.paid_at as string)}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </p>
                          {(p.invoice_ref as { number?: string; url?: string; error?: string } | null)?.number ? (
                            <a href={(p.invoice_ref as { url?: string }).url ?? "#"} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline" data-testid="tax-doc-link">
                              {t("invoicing.issued", { number: String((p.invoice_ref as { number?: string }).number) })}
                            </a>
                          ) : (p.invoice_ref as { error?: string } | null)?.error ? (
                            <p className="text-[12px] text-danger">{t("invoicing.failed")}</p>
                          ) : null}
                        </div>
                        {canWrite && invoicingProvider && !(p.invoice_ref as { number?: string } | null)?.number ? <IssueTaxDocButton paymentId={p.id as string} provider={invoicingProvider} /> : null}
                        {canWrite && !p.external_id ? <DeletePaymentButton id={p.id as string} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
