"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { formLocale, str } from "@/lib/form";
import { encryptionReady, sealSecrets } from "@/lib/channels/secrets";
import { kickJobs } from "@/lib/jobs/kick";

/**
 * Wave 15 — money tools:
 *  - the business's OWN PayPal (customers pay invoices by card / PayPal)
 *  - Morning / iCount: tax documents issued automatically for every payment
 *  - quick payment link from a conversation (invoice + link sent in the chat)
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function saveOrgPayPalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("finance_settings").select("organization_id").eq("organization_id", ctx.org.id).maybeSingle();
  if (str(fd, "disconnect") === "on") {
    const row = { paypal_client_id: null, paypal_secret_enc: null, updated_at: new Date().toISOString() };
    const { error } = existing ? await supabase.from("finance_settings").update(row).eq("organization_id", ctx.org.id) : { error: null };
    if (error) return { error: dbErrorKey(error) };
    revalidatePath(`/${locale}/finance`);
    return { ok: true, message: "orgPaypal.disconnected" };
  }
  const clientId = str(fd, "client_id").trim();
  const secret = str(fd, "secret").trim();
  const mode = str(fd, "mode") === "sandbox" ? "sandbox" : "live";
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(clientId)) return { fieldErrors: { client_id: "orgPaypal.badClientId" } };
  if (secret.length < 10 || secret.length > 200) return { fieldErrors: { secret: "orgPaypal.badSecret" } };
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  // verify the keys with PayPal before saving
  const { orgPayPalToken } = await import("@/lib/finance/org-paypal");
  try {
    await orgPayPalToken({ clientId, secret, mode });
  } catch {
    return { error: "orgPaypal.verifyFailed" };
  }
  const row = { paypal_client_id: clientId, paypal_secret_enc: sealSecrets({ v: secret }), paypal_mode: mode, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from("finance_settings").update(row).eq("organization_id", ctx.org.id)
    : await supabase.from("finance_settings").insert({ ...row, organization_id: ctx.org.id });
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/finance`);
  return { ok: true, message: "orgPaypal.connected" };
}

const invoicingSchema = z.object({
  provider: z.enum(["morning", "icount"]),
  doc_type: z.enum(["invoice_receipt", "receipt"]).default("invoice_receipt"),
  auto: z.boolean(),
  sandbox: z.boolean(),
  key_id: z.string().trim().max(200).optional().default(""),
  key_secret: z.string().trim().max(400).optional().default(""),
  api_token: z.string().trim().max(400).optional().default(""),
});

export async function saveInvoicingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write") || !ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "invoicing_sync"))) return { error: "plans.locked.invoicing_sync.title" };
  const parsed = invoicingSchema.safeParse({
    provider: str(fd, "provider"),
    doc_type: str(fd, "doc_type") || undefined,
    auto: fd.get("auto") === "on",
    sandbox: fd.get("sandbox") === "on",
    key_id: str(fd, "key_id"),
    key_secret: str(fd, "key_secret"),
    api_token: str(fd, "api_token"),
  });
  if (!parsed.success) return { error: "invoicing.invalid" };
  const v = parsed.data;
  const { loadIntegration, removeIntegration, saveIntegration } = await import("@/lib/integrations/store");
  if (str(fd, "disconnect") === "on") {
    await removeIntegration(ctx.org.id, v.provider);
    revalidatePath(`/${locale}/finance`);
    return { ok: true, message: "invoicing.disconnected" };
  }
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const current = await loadIntegration(ctx.org.id, v.provider);
  let secrets: Record<string, string> | undefined;
  const { icountCheck, morningToken } = await import("@/lib/finance/invoicing");
  try {
    if (v.provider === "morning") {
      const id = v.key_id || current?.secrets.key_id || "";
      const secret = v.key_secret || current?.secrets.key_secret || "";
      if (!id || !secret) return { fieldErrors: { key_id: "validation.required" } };
      await morningToken(id, secret, v.sandbox);
      secrets = { key_id: id, key_secret: secret };
    } else {
      const token = v.api_token || current?.secrets.api_token || "";
      if (!token) return { fieldErrors: { api_token: "validation.required" } };
      await icountCheck(token);
      secrets = { api_token: token };
    }
  } catch {
    return { error: "invoicing.verifyFailed" };
  }
  // only one invoicing service at a time
  await removeIntegration(ctx.org.id, v.provider === "morning" ? "icount" : "morning");
  await saveIntegration(ctx.org.id, v.provider, { doc_type: v.doc_type, auto: v.auto, sandbox: v.sandbox }, secrets);
  revalidatePath(`/${locale}/finance`);
  return { ok: true, message: "invoicing.connected" };
}

export async function issueTaxDocAction(fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(str(fd, "paymentId"));
  if (!id.success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { data: p } = await supabase.from("payments").select("id, document_id").eq("id", id.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!p) return { error: "errors.notFound" };
  const { issueTaxDocForPayment } = await import("@/lib/finance/invoicing");
  const r = await issueTaxDocForPayment(id.data);
  revalidatePath(`/${locale}/finance/${p.document_id}`);
  return r.ok ? { ok: true, message: "invoicing.issuedToast" } : { error: r.error === "invoicing_not_connected" ? "invoicing.notConnected" : "invoicing.failed" };
}

const linkSchema = z.object({
  amount: z.coerce.number({ message: "validation.number" }).gt(0, { message: "validation.number" }).max(1_000_000),
  description: z.string().trim().min(1, { message: "validation.required" }).max(200),
  currency: z.string().trim().length(3).toUpperCase().default("ILS"),
  vatIncluded: z.boolean().default(true),
});

/** Quick payment link: an invoice with one line, marked sent, link sent into the conversation. */
export async function createPaymentLinkAction(input: { locale: string; conversationId: string; amount: string; description: string; currency?: string; vatIncluded?: boolean }): Promise<ActionState<{ url: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("finance.write") || !ctx.can("inbox.reply")) return { error: "errors.forbidden" };
  const conv = uuidSchema.safeParse(input.conversationId);
  if (!conv.success) return { error: "validation.invalidId" };
  const parsed = linkSchema.safeParse({ amount: input.amount, description: input.description, currency: input.currency || ctx.org.currency || "ILS", vatIncluded: input.vatIncluded !== false });
  if (!parsed.success) return { error: "payLink.invalid", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const supabase = await createClient();
  const { data: c } = await supabase.from("conversations").select("id, contact_id").eq("id", conv.data).eq("organization_id", ctx.org.id).maybeSingle();
  if (!c) return { error: "errors.notFound" };
  const { data: fs } = await supabase.from("finance_settings").select("default_tax_rate, payment_terms_days").eq("organization_id", ctx.org.id).maybeSingle();
  const rate = Number(fs?.default_tax_rate ?? 18);
  const v = parsed.data;
  const net = v.vatIncluded ? Math.round((v.amount / (1 + rate / 100)) * 100) / 100 : v.amount;
  const due = new Date(Date.now() + Number(fs?.payment_terms_days ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ organization_id: ctx.org.id, kind: "invoice", title: v.description, contact_id: c.contact_id, currency: v.currency, due_date: due, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !doc) return { error: dbErrorKey(error) };
  const { error: le } = await supabase.from("document_lines").insert({ organization_id: ctx.org.id, document_id: doc.id, position: 0, description: v.description, quantity: 1, unit_price: net, discount_pct: 0, tax_rate: rate });
  if (le) return { error: dbErrorKey(le) };
  const { data: sent, error: se } = await supabase.from("documents").update({ status: "sent" }).eq("id", doc.id).eq("organization_id", ctx.org.id).select("public_token, total, currency").single();
  if (se || !sent) return { error: dbErrorKey(se) };
  const { publicEnv } = await import("@/lib/env");
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/q/${sent.public_token}`;
  const total = new Intl.NumberFormat(locale === "en" ? "en-US" : locale === "ar" ? "ar" : "he-IL", { style: "currency", currency: sent.currency as string }).format(Number(sent.total));
  const text = { he: `🧾 ${v.description}\nלתשלום: ${total}\n${url}`, ar: `🧾 ${v.description}\nللدفع: ${total}\n${url}`, en: `🧾 ${v.description}\nAmount due: ${total}\n${url}` }[locale];
  const { sendToConversation } = await import("@/lib/channels/send-message");
  const r = await sendToConversation(ctx.org.id, c.id as string, text, ctx.userId);
  kickJobs();
  revalidatePath(`/${locale}/inbox`);
  if (!r.ok) return { ok: true, message: "payLink.createdNotSent", data: { url } };
  return { ok: true, message: "payLink.sent", data: { url } };
}
