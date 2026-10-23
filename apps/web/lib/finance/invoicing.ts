import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadIntegration, markIntegration } from "@/lib/integrations/store";

/**
 * Wave 15 — legal tax documents (חשבונית מס / קבלה) in the business's own
 * invoicing service, issued automatically when a payment is recorded:
 *   - Morning (Green Invoice)  API key id + secret → JWT → POST /documents
 *   - iCount (API v3)          API token (Bearer)  → POST /doc/create
 * Our documents stay "quote / invoice (חשבון עסקה)"; the tax document number and
 * link are saved on the payment (payments.invoice_ref).
 * Bases are overridable for tests (MORNING_API_BASE, ICOUNT_API_BASE).
 */
export type InvoicingProvider = "morning" | "icount";
export const INVOICING_PROVIDERS: InvoicingProvider[] = ["morning", "icount"];

export function morningBase(sandbox: boolean): string {
  return (process.env.MORNING_API_BASE || (sandbox ? "https://sandbox.d.greeninvoice.co.il/api/v1" : "https://api.greeninvoice.co.il/api/v1")).replace(/\/$/, "");
}
export function icountBase(): string {
  return (process.env.ICOUNT_API_BASE || "https://api.icount.co.il/api/v3.php").replace(/\/$/, "");
}

export interface TaxDocInput {
  docType: "invoice_receipt" | "receipt";
  lang: "he" | "en";
  currency: string;
  date: string;
  description: string;
  client: { name: string; email: string | null; phone: string | null; taxId?: string | null };
  lines: { description: string; quantity: number; unit_price: number; tax_rate: number; discount_pct: number }[];
  payment: { amount: number; method: string; reference: string | null };
  remarks?: string;
}
export interface TaxDocResult {
  id: string;
  number: string;
  url: string | null;
}

/** Green Invoice payment method codes: 1 cash · 2 cheque · 3 credit card · 4 bank transfer · 5 PayPal · 10 payment app · 11 other. */
export function morningPaymentType(method: string): number {
  switch (method) {
    case "cash":
      return 1;
    case "check":
      return 2;
    case "card":
    case "stripe":
      return 3;
    case "transfer":
      return 4;
    case "paypal":
      return 5;
    case "bit":
    case "paybox":
      return 10;
    default:
      return 4;
  }
}

/** Request body for Morning (pure — unit-tested). */
export function morningBody(input: TaxDocInput): Record<string, unknown> {
  const full = input.docType === "invoice_receipt";
  const payment: Record<string, unknown> = { type: morningPaymentType(input.payment.method), price: Math.round(input.payment.amount * 100) / 100, currency: input.currency, date: input.date };
  if (input.payment.method === "bit") payment.appType = 1;
  if (input.payment.reference && ["paypal", "bit", "paybox"].includes(input.payment.method)) payment.transactionId = input.payment.reference.slice(0, 60);
  return {
    type: full ? 320 : 400,
    date: input.date,
    lang: input.lang,
    currency: input.currency,
    vatType: 0,
    description: input.description.slice(0, 200),
    remarks: input.remarks?.slice(0, 500),
    rounding: false,
    signed: true,
    client: {
      name: input.client.name.slice(0, 120) || "—",
      emails: input.client.email ? [input.client.email] : [],
      phone: input.client.phone ?? undefined,
      taxId: input.client.taxId ?? undefined,
      add: false,
    },
    ...(full
      ? {
          income: input.lines.map((l) => ({
            description: l.description.slice(0, 200),
            quantity: l.quantity,
            price: Math.round(l.unit_price * (1 - (l.discount_pct || 0) / 100) * 100) / 100,
            currency: input.currency,
            // 0 = price before VAT (VAT added) · 2 = exempt
            vatType: l.tax_rate > 0 ? 0 : 2,
          })),
        }
      : {}),
    payment: [payment],
  };
}

/** Request body for iCount (pure — unit-tested). */
export function icountBody(input: TaxDocInput): Record<string, unknown> {
  const sum = (Math.round(input.payment.amount * 100) / 100).toFixed(2);
  const pay: Record<string, unknown> =
    input.payment.method === "cash"
      ? { cash: { sum } }
      : ["card", "stripe", "paypal"].includes(input.payment.method)
        ? { cc: { sum, num_of_payments: 1, date: input.date } }
        : input.payment.method === "check"
          ? { cheques: [{ sum, date: input.date }] }
          : { banktransfer: { sum, date: input.date } };
  const full = input.docType === "invoice_receipt";
  return {
    doctype: full ? "invrec" : "receipt",
    client_name: input.client.name.slice(0, 120) || "—",
    email: input.client.email ?? undefined,
    client_phone: input.client.phone ?? undefined,
    vat_id: input.client.taxId ?? undefined,
    currency_code: input.currency,
    lang: input.lang,
    doc_date: input.date,
    hwc: input.remarks?.slice(0, 500),
    items: full
      ? input.lines.map((l) => ({ description: l.description.slice(0, 200), quantity: l.quantity, unitprice: Math.round(l.unit_price * (1 - (l.discount_pct || 0) / 100) * 100) / 100 }))
      : [{ description: input.description.slice(0, 200), quantity: 1, unitprice: Number(sum) }],
    ...pay,
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export async function morningToken(id: string, secret: string, sandbox: boolean): Promise<string> {
  const r = await postJson(`${morningBase(sandbox)}/account/token`, { id: id.trim(), secret: secret.trim() }, {});
  const token = r.json.token as string | undefined;
  if (!r.ok || !token) throw new Error(`morning_auth:${r.status}:${String(r.json.errorMessage ?? r.json.message ?? "unknown").slice(0, 120)}`);
  return token;
}

export async function icountCheck(token: string): Promise<void> {
  const res = await fetch(`${icountBase()}/app/info`, { headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string };
  if (!res.ok || json.status === false) throw new Error(`icount_auth:${res.status}:${json.reason ?? "unknown"}`);
}

export async function createTaxDocument(provider: InvoicingProvider, secrets: Record<string, string>, config: Record<string, unknown>, input: TaxDocInput): Promise<TaxDocResult> {
  if (provider === "morning") {
    const sandbox = config.sandbox === true;
    const token = await morningToken(secrets.key_id ?? "", secrets.key_secret ?? "", sandbox);
    const r = await postJson(`${morningBase(sandbox)}/documents`, morningBody(input), { Authorization: `Bearer ${token}` });
    if (!r.ok || !r.json.id) throw new Error(`morning_error:${r.status}:${String(r.json.errorMessage ?? r.json.message ?? "unknown").slice(0, 200)}`);
    const url = r.json.url as { he?: string; origin?: string } | string | undefined;
    return { id: String(r.json.id), number: String(r.json.number ?? r.json.documentId ?? ""), url: typeof url === "string" ? url : (url?.he ?? url?.origin ?? null) };
  }
  const r = await postJson(`${icountBase()}/doc/create`, icountBody(input), { Authorization: `Bearer ${(secrets.api_token ?? "").trim()}` });
  if (!r.ok || r.json.status === false || !r.json.docnum) throw new Error(`icount_error:${r.status}:${String(r.json.reason ?? r.json.error_description ?? "unknown").slice(0, 200)}`);
  return { id: `${r.json.doctype ?? (input.docType === "invoice_receipt" ? "invrec" : "receipt")}-${r.json.docnum}`, number: String(r.json.docnum), url: (r.json.doc_url as string | undefined) ?? null };
}

/**
 * Issues the tax document for one recorded payment (job "invoice" or the button on
 * the document page). Idempotent: a payment with a document number is skipped.
 */
export async function issueTaxDocForPayment(paymentId: string): Promise<{ ok: boolean; error?: string; permanent?: boolean; result?: TaxDocResult }> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("payments").select("id, organization_id, document_id, amount, method, reference, paid_at, invoice_ref").eq("id", paymentId).maybeSingle();
  if (!p) return { ok: false, error: "payment_not_found", permanent: true };
  const existing = p.invoice_ref as { number?: string } | null;
  if (existing?.number) return { ok: true };
  const orgId = p.organization_id as string;
  let integ = await loadIntegration(orgId, "morning");
  if (!integ || integ.status !== "active") integ = await loadIntegration(orgId, "icount");
  if (!integ || integ.status !== "active") return { ok: false, error: "invoicing_not_connected", permanent: true };
  const provider = integ.provider as InvoicingProvider;
  const { data: d } = await admin.from("documents").select("id, kind, number, title, currency, total, contact_id, organizations(name, locale)").eq("id", p.document_id).maybeSingle();
  if (!d) return { ok: false, error: "document_not_found", permanent: true };
  const [{ data: lines }, { data: contact }] = await Promise.all([
    admin.from("document_lines").select("description, quantity, unit_price, tax_rate, discount_pct").eq("document_id", d.id).order("position"),
    d.contact_id ? admin.from("contacts").select("first_name, last_name, email, phone, company_name, custom_fields").eq("id", d.contact_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const org = d.organizations as unknown as { name: string; locale: string } | null;
  const amount = Number(p.amount);
  const fullPayment = Math.abs(amount - Number(d.total)) < 0.01;
  const wanted = integ.config.doc_type === "receipt" ? "receipt" : "invoice_receipt";
  const input: TaxDocInput = {
    // a partial payment can only be a receipt (the income lines would not match the paid sum)
    docType: wanted === "invoice_receipt" && fullPayment ? "invoice_receipt" : "receipt",
    lang: org?.locale === "en" ? "en" : "he",
    currency: d.currency as string,
    date: String(p.paid_at).slice(0, 10),
    description: `${d.title ? `${d.title} · ` : ""}#${d.number}`,
    client: {
      name: contact ? (`${contact.first_name} ${contact.last_name ?? ""}`.trim() || (contact.company_name as string | null) || "—") : "—",
      email: (contact?.email as string | null) ?? null,
      phone: (contact?.phone as string | null) ?? null,
      taxId: ((contact?.custom_fields as Record<string, string> | null)?.tax_id as string | undefined) ?? null,
    },
    lines: ((lines ?? []) as { description: string; quantity: number; unit_price: number; tax_rate: number; discount_pct: number }[]).map((l) => ({
      description: l.description,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate: Number(l.tax_rate),
      discount_pct: Number(l.discount_pct),
    })),
    payment: { amount, method: p.method as string, reference: (p.reference as string | null) ?? null },
    remarks: org?.name ? `${org.name}` : undefined,
  };
  try {
    const result = await createTaxDocument(provider, integ.secrets, integ.config, input);
    await admin.from("payments").update({ invoice_ref: { provider, ...result, type: input.docType, at: new Date().toISOString() } }).eq("id", p.id);
    await markIntegration(integ.id, true);
    return { ok: true, result };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await admin.from("payments").update({ invoice_ref: { provider, error: msg, at: new Date().toISOString() } }).eq("id", p.id);
    await markIntegration(integ.id, false, msg);
    // auth / validation errors will not fix themselves
    return { ok: false, error: msg, permanent: /_(auth|error):4\d\d/.test(msg) };
  }
}
