"use server";

import { revalidatePath } from "next/cache";
import { documentSchema, financeSettingsSchema, paymentSchema, productSchema } from "@scc/shared/engagement";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { kickJobs } from "@/lib/jobs/kick";
import { formLocale, pick, str } from "@/lib/form";
import { publicEnv } from "@/lib/env";
import { emailConfigured } from "@/lib/email/send";
import { encryptionReady, sealSecrets } from "@/lib/channels/secrets";

const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");
function revalidateFinance(locale: string, id?: string) {
  revalidatePath(`/${locale}/finance`);
  if (id) revalidatePath(`/${locale}/finance/${id}`);
}

export async function saveDocumentAction(input: { locale: string; id?: string; data: unknown }): Promise<ActionState<{ id: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const parsed = documentSchema.safeParse(input.data);
  if (!parsed.success) return { error: "finance.invalid", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const row = {
    kind: d.kind,
    title: d.title || null,
    contact_id: d.contactId ?? null,
    company_id: d.companyId ?? null,
    deal_id: d.dealId ?? null,
    issue_date: d.issue_date ?? new Date().toISOString().slice(0, 10),
    due_date: d.due_date ?? null,
    currency: d.currency,
    notes: d.notes || null,
    payment_url: d.payment_url || null,
  };
  const supabase = await createClient();
  let id = input.id;
  if (id) {
    const ok = uuidSchema.safeParse(id);
    if (!ok.success) return { error: "validation.invalidId" };
    const { data, error } = await supabase.from("documents").update(row).eq("id", id).eq("organization_id", ctx.org.id).eq("status", "draft").select("id");
    if (error) return { error: dbErrorKey(error) };
    if (!data?.length) return { error: "finance.onlyDraft" };
    await supabase.from("document_lines").delete().eq("document_id", id).eq("organization_id", ctx.org.id);
  } else {
    const { data, error } = await supabase.from("documents").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId }).select("id").single();
    if (error) return { error: dbErrorKey(error) };
    id = data.id as string;
  }
  const { error: lineError } = await supabase.from("document_lines").insert(
    d.lines.map((l, i) => ({ organization_id: ctx.org.id, document_id: id, position: i, description: l.description, quantity: l.quantity, unit_price: l.unit_price, discount_pct: l.discount_pct, tax_rate: l.tax_rate })),
  );
  if (lineError) return { error: dbErrorKey(lineError) };
  revalidateFinance(locale, id);
  return { ok: true, message: "finance.saved", data: { id: id! } };
}

/** Mark as sent and e-mail the customer a link (when e-mail is configured). */
export async function sendDocumentAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .update({ status: "sent" })
    .eq("id", id.data)
    .eq("organization_id", ctx.org.id)
    .in("status", ["draft", "sent"])
    .select("kind, number, total, currency, public_token, contacts(email, first_name)")
    .maybeSingle();
  if (error) return { error: dbErrorKey(error) };
  if (!doc) return { error: "errors.notFound" };
  const contact = doc.contacts as unknown as { email: string | null; first_name: string } | null;
  let emailed = false;
  if (contact?.email && emailConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const link = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/q/${doc.public_token}`;
    const label = { he: { quote: "הצעת מחיר", invoice: "חשבון עסקה" }, ar: { quote: "عرض سعر", invoice: "فاتورة" }, en: { quote: "Quote", invoice: "Invoice" } }[locale][doc.kind as "quote" | "invoice"];
    const total = new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL", { style: "currency", currency: doc.currency as string }).format(Number(doc.total));
    await createAdminClient()
      .from("jobs")
      .insert({ organization_id: ctx.org.id, kind: "email", payload: { to: contact.email, subject: `${label} #${doc.number} — ${ctx.org.name}`, text: `${contact.first_name},\n\n${label} #${doc.number}: ${total}\n${link}\n\n${ctx.org.name}` } });
    emailed = true;
    kickJobs();
  }
  revalidateFinance(locale, id.data);
  return { ok: true, message: emailed ? "finance.sentEmailed" : "finance.sent" };
}

export async function setDocumentStatusAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = str(fd, "status");
  if (!id.success || !["draft", "accepted", "declined", "void"].includes(status)) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update({ status }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: error.message.includes("invalid_status") ? "finance.invalidStatus" : dbErrorKey(error) };
  revalidateFinance(locale, id.data);
  return { ok: true, message: `finance.status_${status}` };
}

export async function convertToInvoiceAction(fd: FormData): Promise<ActionState<{ id: string }>> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: q } = await supabase.from("documents").select("*").eq("id", id.data).eq("organization_id", ctx.org.id).eq("kind", "quote").maybeSingle();
  if (!q) return { error: "errors.notFound" };
  const { data: settings } = await supabase.from("finance_settings").select("payment_terms_days").eq("organization_id", ctx.org.id).maybeSingle();
  const due = new Date(Date.now() + ((settings?.payment_terms_days as number | undefined) ?? 30) * 86_400_000).toISOString().slice(0, 10);
  const { data: inv, error } = await supabase
    .from("documents")
    .insert({ organization_id: ctx.org.id, kind: "invoice", title: q.title, contact_id: q.contact_id, company_id: q.company_id, deal_id: q.deal_id, currency: q.currency, notes: q.notes, payment_url: q.payment_url, due_date: due, source_document_id: q.id, created_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error) };
  const { data: lines } = await supabase.from("document_lines").select("position, description, quantity, unit_price, discount_pct, tax_rate").eq("document_id", q.id);
  if (lines?.length) await supabase.from("document_lines").insert(lines.map((l) => ({ ...l, organization_id: ctx.org.id, document_id: inv.id })));
  revalidateFinance(locale);
  return { ok: true, message: "finance.converted", data: { id: inv.id as string } };
}

export async function deleteDocumentAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").delete().eq("id", id.data).eq("organization_id", ctx.org.id).eq("status", "draft").select("id");
  if (error) return { error: dbErrorKey(error) };
  if (!data?.length) return { error: "finance.onlyDraftDelete" };
  revalidateFinance(locale);
  return { ok: true, message: "finance.deleted" };
}

export async function recordPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["amount", "method", "reference", "paid_at"]);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden", values };
  const id = uuidSchema.safeParse(str(fd, "documentId"));
  const parsed = paymentSchema.safeParse(values);
  if (!id.success) return { error: "validation.invalidId", values };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    organization_id: ctx.org.id,
    document_id: id.data,
    amount: parsed.data.amount,
    method: parsed.data.method,
    reference: parsed.data.reference || null,
    paid_at: parsed.data.paid_at ? new Date(parsed.data.paid_at).toISOString() : new Date().toISOString(),
    created_by: ctx.userId,
  });
  if (error) return { error: dbErrorKey(error), values };
  kickJobs();
  revalidateFinance(locale, id.data);
  return { ok: true, message: "finance.paymentRecorded" };
}

export async function deletePaymentAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").delete().eq("id", id.data).eq("organization_id", ctx.org.id).is("external_id", null);
  if (error) return { error: dbErrorKey(error) };
  revalidateFinance(locale);
  return { ok: true, message: "finance.paymentDeleted" };
}

/* ------------------------------------------------------------- products */
export async function saveProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const values = pick(fd, ["name", "description", "unit_price", "tax_rate"]);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden", values };
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const row = { name: parsed.data.name, description: parsed.data.description || null, unit_price: parsed.data.unit_price, tax_rate: parsed.data.tax_rate ?? null };
  const supabase = await createClient();
  const rawId = str(fd, "id");
  const { error } = rawId
    ? await supabase.from("products").update(row).eq("id", rawId).eq("organization_id", ctx.org.id)
    : await supabase.from("products").insert({ ...row, organization_id: ctx.org.id });
  if (error) return { error: dbErrorKey(error), values };
  revalidateFinance(locale);
  return { ok: true, message: "finance.productSaved" };
}

export async function deleteProductAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidateFinance(locale);
  return { ok: true, message: "finance.productDeleted" };
}

/* ------------------------------------------------------------- settings */
export async function saveFinanceSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  const keys = ["business_name", "business_id", "address", "phone", "email", "default_tax_rate", "quote_valid_days", "payment_terms_days", "payment_instructions", "default_notes", "stripe_secret_key", "stripe_webhook_secret"];
  const values = pick(fd, keys);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden", values };
  const parsed = financeSettingsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { ...values, stripe_secret_key: "", stripe_webhook_secret: "" } };
  const { stripe_secret_key, stripe_webhook_secret, ...rest } = parsed.data;
  const row: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === "" ? null : v])),
    updated_at: new Date().toISOString(),
  };
  if (stripe_secret_key || stripe_webhook_secret) {
    if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
    if (stripe_secret_key) row.stripe_secret_enc = sealSecrets({ v: stripe_secret_key });
    if (stripe_webhook_secret) row.stripe_webhook_secret_enc = sealSecrets({ v: stripe_webhook_secret });
  }
  if (str(fd, "stripe_disconnect") === "on") {
    row.stripe_secret_enc = null;
    row.stripe_webhook_secret_enc = null;
  }
  const supabase = await createClient();
  // No upsert: ON CONFLICT DO UPDATE needs SELECT on every column, and the encrypted
  // Stripe columns are deliberately not selectable by users (column grants).
  const { data: existing } = await supabase.from("finance_settings").select("organization_id").eq("organization_id", ctx.org.id).maybeSingle();
  const { error } = existing
    ? await supabase.from("finance_settings").update(row).eq("organization_id", ctx.org.id)
    : await supabase.from("finance_settings").insert({ ...row, organization_id: ctx.org.id });
  if (error) return { error: dbErrorKey(error) };
  revalidateFinance(locale);
  return { ok: true, message: "finance.settingsSaved" };
}
