import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { DocumentPublicActions, PrintButton } from "@/components/public/document-actions";
import { ContractSign } from "@/components/public/contract-sign";
import { visitorHash } from "@/lib/visitor";

type Params = Promise<{ locale: string; token: string }>;

interface PublicDoc {
  kind: "quote" | "invoice";
  number: number;
  status: string;
  title: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  notes: string | null;
  payment_url: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  expired: boolean;
  org: { name: string } | null;
  seller: { business_name: string | null; business_id: string | null; address: string | null; phone: string | null; email: string | null; payment_instructions: string | null } | null;
  online_payment: boolean;
  customer: { name: string; email: string | null; phone: string | null; company: string | null } | null;
  lines: { description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate: number; line_total: number }[];
  // wave 15 (get_public_document_v2)
  require_signature?: boolean;
  contract_terms?: string | null;
  signed_at?: string | null;
  signature?: string | null;
  content_hash?: string | null;
  paypal?: boolean;
  stripe?: boolean;
}

async function load(token: string): Promise<PublicDoc | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const anon = createAnonClient();
  // wave 15: v2 adds the contract, signature and payment options; v1 before the migration ran
  const v2 = await anon.rpc("get_public_document_v2", { p_token: token });
  if (!v2.error) return (v2.data as PublicDoc | null) ?? null;
  const { data } = await anon.rpc("get_public_document", { p_token: token });
  return (data as PublicDoc | null) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  const doc = await load((await params).token);
  return { title: doc ? `${t(`finance.kindLong.${doc.kind}`)} #${doc.number} — ${doc.org?.name ?? ""}` : t("errors.notFound"), robots: { index: false } };
}

export default async function PublicDocumentPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const { t } = await getT(locale);
  const doc = await load(token);
  if (!doc) notFound();
  const sp = await searchParams;
  // wave 15: the business sees that (and when) the customer opened the document
  await createAnonClient().rpc("track_document_view", { p_token: token, p_visitor: await visitorHash() }).then(() => undefined, () => undefined);
  const needsSignature = doc.kind === "quote" && Boolean(doc.require_signature) && !doc.signed_at;
  const money = (n: number) => formatCurrency(locale, Number(n), doc.currency);
  const balance = Math.round((Number(doc.total) - Number(doc.amount_paid)) * 100) / 100;
  const seller = doc.seller;
  const sellerName = seller?.business_name || doc.org?.name || "";
  const statusKey = doc.expired ? "expired" : doc.status;

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2 print:hidden">
        <PrintButton />
      </div>
      <article className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-10 print:rounded-none print:border-0 print:shadow-none" data-testid="public-document">
        <header className="flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {t(`finance.kindLong.${doc.kind}`)} #{doc.number}
            </h1>
            {doc.title ? <p className="mt-1 text-muted">{doc.title}</p> : null}
            <p className="mt-2 text-[12.5px] text-subtle">{t("finance.notTaxInvoice")}</p>
          </div>
          <div className="text-[13px] sm:text-end">
            <p className="text-base font-semibold">{sellerName}</p>
            {seller?.business_id ? <p className="text-muted">{t("finance.businessId")}: <span dir="ltr">{seller.business_id}</span></p> : null}
            {seller?.address ? <p className="text-muted">{seller.address}</p> : null}
            {seller?.phone ? <p className="text-muted"><span dir="ltr">{seller.phone}</span></p> : null}
            {seller?.email ? <p className="text-muted"><span dir="ltr">{seller.email}</span></p> : null}
          </div>
        </header>
        <section className="grid gap-4 border-b border-line py-5 text-[13px] sm:grid-cols-2">
          <div>
            <p className="text-subtle">{t("finance.billTo")}</p>
            {doc.customer ? (
              <>
                <p className="font-medium">{doc.customer.name}</p>
                {doc.customer.company ? <p className="text-muted">{doc.customer.company}</p> : null}
                {doc.customer.email ? <p className="text-muted"><span dir="ltr">{doc.customer.email}</span></p> : null}
              </>
            ) : (
              <p>—</p>
            )}
          </div>
          <div className="space-y-0.5 sm:text-end">
            <p>
              <span className="text-subtle">{t("finance.issueDate")}: </span>
              {formatDate(locale, doc.issue_date)}
            </p>
            {doc.due_date ? (
              <p>
                <span className="text-subtle">{t(doc.kind === "quote" ? "finance.validUntil" : "finance.dueDate")}: </span>
                {formatDate(locale, doc.due_date)}
              </p>
            ) : null}
            <p>
              <span className="text-subtle">{t("finance.status")}: </span>
              <span className="font-medium" data-testid="public-doc-status">
                {t(`finance.statuses.${statusKey}`)}
              </span>
            </p>
          </div>
        </section>
        <div className="overflow-x-auto">
          <table className="mt-4 w-full min-w-[480px] text-sm">
            <thead className="text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-start font-medium">{t("finance.description")}</th>
                <th className="py-2 text-end font-medium">{t("finance.quantity")}</th>
                <th className="py-2 text-end font-medium">{t("finance.unitPrice")}</th>
                <th className="py-2 text-end font-medium">{t("finance.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="py-2">
                    {l.description}
                    {Number(l.discount_pct) ? <span className="text-subtle"> ({t("finance.discount")} {Number(l.discount_pct)}%)</span> : null}
                  </td>
                  <td className="py-2 text-end tabular-nums">{Number(l.quantity)}</td>
                  <td className="py-2 text-end tabular-nums">{money(l.unit_price)}</td>
                  <td className="py-2 text-end tabular-nums">{money(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ms-auto mt-5 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("finance.subtotal")}</dt>
            <dd className="tabular-nums">{money(doc.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("finance.tax")}</dt>
            <dd className="tabular-nums">{money(doc.tax_total)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-lg font-bold">
            <dt>{t("finance.total")}</dt>
            <dd className="tabular-nums">{money(doc.total)}</dd>
          </div>
          {doc.kind === "invoice" && Number(doc.amount_paid) > 0 ? (
            <>
              <div className="flex justify-between">
                <dt className="text-muted">{t("finance.paid")}</dt>
                <dd className="tabular-nums">{money(doc.amount_paid)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>{t("finance.balance")}</dt>
                <dd className="tabular-nums">{money(Math.max(0, balance))}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {doc.notes ? <p className="mt-6 whitespace-pre-wrap text-[13px] text-muted">{doc.notes}</p> : null}
        {doc.kind === "invoice" && seller?.payment_instructions ? (
          <section className="mt-6 rounded-2xl bg-elevated p-4 text-[13px]">
            <p className="mb-1 font-semibold">{t("finance.paymentInstructions")}</p>
            <p className="whitespace-pre-wrap">{seller.payment_instructions}</p>
          </section>
        ) : null}
        {doc.contract_terms ? (
          <section className="mt-6 rounded-2xl border border-line p-4" data-testid="public-contract-terms">
            <h2 className="mb-2 text-sm font-semibold">{t("contract.terms")}</h2>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{doc.contract_terms}</p>
          </section>
        ) : null}
        {doc.signed_at ? (
          <section className="mt-6 rounded-2xl border border-success/30 bg-success-soft p-4" data-testid="public-signature">
            <p className="text-sm font-semibold text-success">{t("contract.signedBy", { name: doc.accepted_by_name ?? "", date: formatDateTime(locale, doc.signed_at) })}</p>
            {doc.signature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.signature} alt={t("contract.signatureAlt")} className="mt-2 h-20 max-w-full rounded-lg bg-white p-1" />
            ) : null}
            {doc.content_hash ? (
              <p className="mt-2 break-all text-[11px] text-muted">
                {t("contract.hash")}: <bdi dir="ltr" className="font-mono">{doc.content_hash}</bdi>
              </p>
            ) : null}
          </section>
        ) : null}
        {doc.accepted_at && !doc.signed_at ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> {t("finance.acceptedOn", { name: doc.accepted_by_name ?? "", date: formatDateTime(locale, doc.accepted_at) })}
          </p>
        ) : null}
        {sp.paid === "1" && doc.status !== "paid" ? <p role="status" className="mt-6 text-sm text-muted">{t("finance.paymentProcessing")}</p> : null}
        {sp.paid === "0" ? <p role="alert" className="mt-6 text-sm text-danger">{t("finance.onlineFailed")}</p> : null}
        <div className="mt-8 print:hidden">
          {needsSignature && doc.status === "sent" && !doc.expired ? (
            <ContractSign token={token} />
          ) : (
            <DocumentPublicActions
              token={token}
              kind={doc.kind}
              canAccept={doc.kind === "quote" && doc.status === "sent" && !doc.expired && !needsSignature}
              canPay={doc.kind === "invoice" && ["sent", "accepted"].includes(doc.status) && balance > 0}
              online={doc.stripe ?? doc.online_payment}
              paypal={Boolean(doc.paypal)}
              paymentUrl={doc.payment_url}
              balanceLabel={money(balance)}
            />
          )}
        </div>
      </article>
      <p className="mt-6 text-center text-[11.5px] text-subtle print:hidden">{t("public.poweredBy")}</p>
    </main>
  );
}
