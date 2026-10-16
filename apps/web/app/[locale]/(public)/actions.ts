"use server";

import { createAnonClient } from "@/lib/supabase/anon";
import { visitorHash } from "@/lib/visitor";
import { kickJobs } from "@/lib/jobs/kick";

export interface PublicResult {
  ok: boolean;
  error?: string;
  errors?: Record<string, string>;
  message?: string | null;
  redirect?: string | null;
  data?: Record<string, unknown>;
}

function mapError(message: string | undefined): string {
  if (!message) return "errors.generic";
  if (message.includes("rate_limited")) return "public.rateLimited";
  if (message.includes("not_found")) return "errors.notFound";
  return "errors.generic";
}

export async function submitPublicForm(input: { slug: string; data: Record<string, string>; utm?: Record<string, string>; honeypot?: string }): Promise<PublicResult> {
  // bots fill the hidden field — pretend success, store nothing
  if (input.honeypot) return { ok: true };
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(input.slug)) return { ok: false, error: "errors.notFound" };
  const utm = Object.fromEntries(Object.entries(input.utm ?? {}).filter(([k, v]) => /^utm_[a-z]{1,20}$/.test(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 120)]));
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("submit_form", { p_slug: input.slug, p_data: input.data, p_meta: { ip_hash: await visitorHash(), utm } });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; errors?: Record<string, string>; message?: string; redirect?: string };
  if (r.ok) kickJobs();
  return { ok: r.ok, errors: r.errors, message: r.message ?? null, redirect: r.redirect && /^https:\/\//.test(r.redirect) ? r.redirect : null };
}

export async function bookPublicAppointment(input: { slug: string; start: string; name: string; email: string; phone: string; notes: string }): Promise<PublicResult> {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(input.slug) || Number.isNaN(Date.parse(input.start))) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("book_appointment", {
    p_slug: input.slug,
    p_start: new Date(input.start).toISOString(),
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 254),
    p_phone: input.phone.slice(0, 32),
    p_notes: input.notes.slice(0, 2000),
    p_meta: { ip_hash: await visitorHash() },
  });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string; token?: string; starts_at?: string };
  if (r.ok) kickJobs();
  return { ok: r.ok, error: r.error, data: r.ok ? { token: r.token, starts_at: r.starts_at } : undefined };
}

export async function cancelPublicAppointment(token: string): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("cancel_public_appointment", { p_token: token });
  if (error) return { ok: false, error: mapError(error.message) };
  return { ok: Boolean((data as { ok: boolean }).ok) };
}

export async function unsubscribePublic(token: string): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("unsubscribe", { p_token: token });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; org?: string };
  return { ok: r.ok, data: { org: r.org } };
}

/* ------------------------------------------------ support portal (wave 4) */
export async function createPublicTicket(input: { org: string; name: string; email: string; subject: string; body: string }): Promise<PublicResult> {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(input.org)) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("create_public_ticket", {
    p_org_slug: input.org,
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 254),
    p_subject: input.subject.slice(0, 200),
    p_body: input.body.slice(0, 20000),
    p_meta: { ip_hash: await visitorHash() },
  });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string; number?: number; token?: string };
  if (r.ok) kickJobs();
  return { ok: r.ok, error: r.error, data: r.ok ? { number: r.number, token: r.token } : undefined };
}

export async function replyPublicTicket(input: { token: string; body: string }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("reply_public_ticket", { p_token: input.token, p_body: input.body.slice(0, 20000), p_meta: { ip_hash: await visitorHash() } });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string };
  return { ok: r.ok, error: r.error };
}

/* ------------------------------------------- quotes / invoices (wave 4) */
export async function acceptPublicQuote(input: { token: string; name: string }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("accept_public_quote", { p_token: input.token, p_name: input.name.slice(0, 120) });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string };
  return { ok: r.ok, error: r.error };
}

/** "Pay online": Stripe Checkout in the organization's OWN Stripe account for the open balance. */
export async function startDocumentPayment(input: { token: string; locale: string }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { encryptionReady, openSecrets } = await import("@/lib/channels/secrets");
  const { createDocumentCheckout } = await import("@/lib/finance/org-stripe");
  const { publicEnv } = await import("@/lib/env");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !encryptionReady()) return { ok: false, error: "finance.onlineUnavailable" };
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("documents")
    .select("organization_id, kind, number, status, total, amount_paid, currency, title, public_token, contacts(email), organizations(name)")
    .eq("public_token", input.token)
    .maybeSingle();
  if (!doc || doc.kind !== "invoice" || !["sent", "accepted"].includes(doc.status as string)) return { ok: false, error: "finance.cannotPay" };
  const due = Math.round((Number(doc.total) - Number(doc.amount_paid)) * 100) / 100;
  if (!(due > 0)) return { ok: false, error: "finance.cannotPay" };
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `pay:${input.token}:${await visitorHash()}`, p_limit: 10, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "public.rateLimited" };
  const { data: fs } = await admin.from("finance_settings").select("stripe_secret_enc, stripe_webhook_secret_enc").eq("organization_id", doc.organization_id).maybeSingle();
  const key = fs?.stripe_secret_enc && fs.stripe_webhook_secret_enc ? openSecrets(fs.stripe_secret_enc as string).v : "";
  if (!key) return { ok: false, error: "finance.onlineUnavailable" };
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const base = `${publicEnv.appUrl.replace(/\/$/, "")}/${locale}/q/${input.token}`;
  const org = (doc.organizations as unknown as { name: string } | null)?.name ?? "";
  try {
    const url = await createDocumentCheckout(key, {
      amount: due,
      currency: doc.currency as string,
      name: `${org} #${doc.number}${doc.title ? ` — ${doc.title}` : ""}`,
      documentToken: input.token,
      successUrl: `${base}?paid=1`,
      cancelUrl: base,
      email: (doc.contacts as unknown as { email: string | null } | null)?.email ?? null,
    });
    if (!/^https?:\/\//.test(url)) return { ok: false, error: "finance.onlineUnavailable" };
    return { ok: true, redirect: url };
  } catch {
    return { ok: false, error: "finance.onlineFailed" };
  }
}
