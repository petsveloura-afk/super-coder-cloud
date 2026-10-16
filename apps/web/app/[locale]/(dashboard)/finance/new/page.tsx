import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/finance/document-editor";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { financeEditorData, isoDay } from "@/lib/finance/editor-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("finance.title") };
}

export default async function NewDocumentPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("finance.write")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const kind = sp.kind === "invoice" ? "invoice" : "quote";
  const pre = (k: string) => (uuidSchema.safeParse(sp[k]).success ? (sp[k] as string) : "");
  const data = await financeEditorData(ctx.org.id);
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  return (
    <>
      <Link href={`/${locale}/finance`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <Back className="h-4 w-4" /> {t("finance.title")}
      </Link>
      <PageHeader title={t(kind === "quote" ? "finance.newQuote" : "finance.newInvoice")} description={t("finance.notTaxInvoice")} />
      <DocumentEditor
        contacts={data.contacts}
        companies={data.companies}
        deals={data.deals}
        products={data.products}
        defaultTax={data.defaultTax}
        initial={{
          kind,
          title: "",
          contactId: pre("contact"),
          companyId: pre("company"),
          dealId: pre("deal"),
          issue_date: isoDay(0),
          due_date: isoDay(kind === "quote" ? data.quoteValidDays : data.paymentTermsDays),
          currency: "ILS",
          notes: data.defaultNotes,
          payment_url: "",
          lines: [{ description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: String(data.defaultTax) }],
        }}
      />
    </>
  );
}
