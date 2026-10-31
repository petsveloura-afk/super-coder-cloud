import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

/**
 * Wave 59 — payment inside the chat: the AI agent (or the team) sends a secure payment link for an order or
 * a booking deposit. The link is an invoice in the business's own finance module, paid online through the
 * business's OWN Stripe / PayPal; when it is paid the chat shows "paid" and the team is notified (database
 * trigger). Never throws.
 */

/** The business can take online payments (its own Stripe or PayPal is connected). */
export async function canPayOnline(orgId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("finance_settings").select("stripe_secret_enc, stripe_webhook_secret_enc, paypal_client_id, paypal_secret_enc").eq("organization_id", orgId).maybeSingle();
    if (!data) return false;
    return Boolean((data.stripe_secret_enc && data.stripe_webhook_secret_enc) || (data.paypal_client_id && data.paypal_secret_enc));
  } catch {
    return false;
  }
}

type Loc = "he" | "en" | "ar";

export function payLinkText(locale: Loc, input: { description: string; total: string; url: string }): string {
  return {
    he: `💳 ${input.description}\nלתשלום מאובטח: ${input.total}\n${input.url}`,
    en: `💳 ${input.description}\nSecure payment: ${input.total}\n${input.url}`,
    ar: `💳 ${input.description}\nدفع آمن: ${input.total}\n${input.url}`,
  }[locale];
}

/** Creates the invoice + payment link for a conversation (VAT included in the amount). */
export async function createChatPaymentLink(input: { orgId: string; conversationId: string; contactId: string | null; amount: number; description: string; locale: Loc }): Promise<{ url: string; text: string } | null> {
  try {
    if (!(input.amount > 0) || input.amount > 100_000) return null;
    const admin = createAdminClient();
    const [{ data: org }, { data: fs }] = await Promise.all([
      admin.from("organizations").select("currency").eq("id", input.orgId).maybeSingle(),
      admin.from("finance_settings").select("default_tax_rate, payment_terms_days").eq("organization_id", input.orgId).maybeSingle(),
    ]);
    const currency = String(org?.currency || "ILS").toUpperCase().slice(0, 3);
    const rate = Number(fs?.default_tax_rate ?? 18);
    const net = Math.round((input.amount / (1 + rate / 100)) * 100) / 100;
    const due = new Date(Date.now() + Number(fs?.payment_terms_days ?? 7) * 86_400_000).toISOString().slice(0, 10);
    const title = input.description.slice(0, 200);
    const { data: doc, error } = await admin.from("documents").insert({ organization_id: input.orgId, kind: "invoice", title, contact_id: input.contactId, currency, due_date: due }).select("id").single();
    if (error || !doc) return null;
    const { error: le } = await admin.from("document_lines").insert({ organization_id: input.orgId, document_id: doc.id, position: 0, description: title, quantity: 1, unit_price: net, discount_pct: 0, tax_rate: rate });
    if (le) return null;
    const { data: sent } = await admin.from("documents").update({ status: "sent" }).eq("id", doc.id).eq("organization_id", input.orgId).select("public_token, total, currency").single();
    if (!sent) return null;
    await admin
      .from("chat_payments")
      .insert({ organization_id: input.orgId, conversation_id: input.conversationId, document_id: doc.id, amount: Number(sent.total), currency: String(sent.currency), description: title })
      .then(() => undefined, () => undefined);
    const url = `${publicEnv.appUrl.replace(/\/$/, "")}/${input.locale}/q/${sent.public_token as string}`;
    const total = new Intl.NumberFormat(input.locale === "en" ? "en-US" : input.locale === "ar" ? "ar" : "he-IL", { style: "currency", currency: String(sent.currency) }).format(Number(sent.total));
    return { url, text: payLinkText(input.locale, { description: title, total, url }) };
  } catch (e) {
    console.error("chat payment link failed", (e as Error).message);
    return null;
  }
}
