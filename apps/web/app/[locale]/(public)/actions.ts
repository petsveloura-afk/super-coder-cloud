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

/**
 * Wave 24 — app-level throttle for the public token links (cancel, unsubscribe, quotes, tickets,
 * helpful votes): per link + visitor. Fails open if the limiter is unreachable, so a real customer
 * is never blocked by an infrastructure hiccup; the database keeps its own limits as well.
 */
async function throttled(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data } = await createAdminClient().rpc("public_rate_limit", { p_bucket: `${bucket}:${await visitorHash()}`, p_limit: limit, p_window_seconds: windowSeconds });
    return data === false;
  } catch {
    return false;
  }
}
const LIMITED: PublicResult = { ok: false, error: "public.rateLimited" };

function mapError(message: string | undefined): string {
  if (!message) return "errors.generic";
  if (message.includes("rate_limited")) return "public.rateLimited";
  if (message.includes("not_found")) return "errors.notFound";
  return "errors.generic";
}

export async function submitPublicForm(input: { slug: string; data: Record<string, string>; utm?: Record<string, string>; honeypot?: string; visitor?: string | null }): Promise<PublicResult> {
  // bots fill the hidden field — pretend success, store nothing
  if (input.honeypot) return { ok: true };
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(input.slug)) return { ok: false, error: "errors.notFound" };
  const utm = Object.fromEntries(Object.entries(input.utm ?? {}).filter(([k, v]) => /^utm_[a-z]{1,20}$/.test(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 120)]));
  const supabase = createAnonClient();
  // wave 17: the website visitor id (random) links the visitor to the contact for behavior triggers
  const visitor = typeof input.visitor === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.visitor) ? input.visitor : undefined;
  const { data, error } = await supabase.rpc("submit_form", { p_slug: input.slug, p_data: input.data, p_meta: { ip_hash: await visitorHash(), utm, ...(visitor ? { visitor } : {}) } });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; errors?: Record<string, string>; message?: string; redirect?: string };
  if (r.ok) kickJobs();
  return { ok: r.ok, errors: r.errors, message: r.message ?? null, redirect: r.redirect && /^https:\/\//.test(r.redirect) ? r.redirect : null };
}

export async function bookPublicAppointment(input: { slug: string; start: string; name: string; email: string; phone: string; notes: string }): Promise<PublicResult> {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(input.slug) || Number.isNaN(Date.parse(input.start))) return { ok: false, error: "errors.notFound" };
  const supabase = createAnonClient();
  const args = {
    p_slug: input.slug,
    p_start: new Date(input.start).toISOString(),
    p_name: input.name.slice(0, 120),
    p_email: input.email.slice(0, 254),
    p_phone: input.phone.slice(0, 32),
    p_notes: input.notes.slice(0, 2000),
    p_meta: { ip_hash: await visitorHash() },
  };
  // wave 16: v2 also respects busy times from the host's connected Google / Outlook calendar
  let { data, error } = await supabase.rpc("book_appointment_v2", args);
  if (error?.code === "PGRST202") ({ data, error } = await supabase.rpc("book_appointment", args));
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string; token?: string; starts_at?: string };
  if (r.ok) kickJobs();
  return { ok: r.ok, error: r.error, data: r.ok ? { token: r.token, starts_at: r.starts_at } : undefined };
}

export async function cancelPublicAppointment(token: string): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { ok: false, error: "errors.notFound" };
  if (await throttled(`appt-cancel:${token}`, 10, 600)) return LIMITED;
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("cancel_public_appointment", { p_token: token });
  if (error) return { ok: false, error: mapError(error.message) };
  return { ok: Boolean((data as { ok: boolean }).ok) };
}

export async function unsubscribePublic(token: string): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(token)) return { ok: false, error: "errors.notFound" };
  if (await throttled(`unsub:${token}`, 10, 600)) return LIMITED;
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
  if (await throttled(`ticket-reply:${input.token}`, 20, 600)) return LIMITED;
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("reply_public_ticket", { p_token: input.token, p_body: input.body.slice(0, 20000), p_meta: { ip_hash: await visitorHash() } });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string };
  return { ok: r.ok, error: r.error };
}

/* ------------------------------------------- quotes / invoices (wave 4) */
export async function acceptPublicQuote(input: { token: string; name: string }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  if (await throttled(`quote-accept:${input.token}`, 10, 600)) return LIMITED;
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

/* ------------------------------------------- wave 15: contracts + PayPal */
/** The customer signs a quote (drawn signature) — becomes a signed contract with a content hash. */
export async function signPublicQuote(input: { token: string; name: string; signature: string; agree: boolean }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  if (!input.agree) return { ok: false, error: "contract.mustAgree" };
  if (await throttled(`quote-sign:${input.token}`, 10, 600)) return LIMITED;
  if (typeof input.signature !== "string" || !input.signature.startsWith("data:image/png;base64,") || input.signature.length > 300_000) return { ok: false, error: "contract.sign.required" };
  const { headers } = await import("next/headers");
  const h = await headers();
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("sign_public_quote", {
    p_token: input.token,
    p_name: input.name.slice(0, 120),
    p_signature: input.signature,
    p_meta: { ip_hash: await visitorHash(), ua: (h.get("user-agent") ?? "").slice(0, 300) },
  });
  if (error) return { ok: false, error: mapError(error.message) };
  const r = data as { ok: boolean; error?: string };
  kickJobs();
  return { ok: r.ok, error: r.error ? (r.error === "finance.sign.required" ? "contract.sign.required" : r.error) : undefined };
}

/** "Pay by card / PayPal": a one-time order in the business's OWN PayPal account for the open balance. */
export async function startDocumentPayPal(input: { token: string; locale: string }): Promise<PublicResult> {
  if (!/^[a-f0-9]{32}$/.test(input.token)) return { ok: false, error: "errors.notFound" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "finance.onlineUnavailable" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { loadOrgPayPal, createOrgPayPalOrder } = await import("@/lib/finance/org-paypal");
  const { publicEnv } = await import("@/lib/env");
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("documents")
    .select("organization_id, kind, number, status, total, amount_paid, currency, title, public_token, organizations(name)")
    .eq("public_token", input.token)
    .maybeSingle();
  if (!doc || doc.kind !== "invoice" || !["sent", "accepted"].includes(doc.status as string)) return { ok: false, error: "finance.cannotPay" };
  const due = Math.round((Number(doc.total) - Number(doc.amount_paid)) * 100) / 100;
  if (!(due > 0)) return { ok: false, error: "finance.cannotPay" };
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `paypal:${input.token}:${await visitorHash()}`, p_limit: 10, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "public.rateLimited" };
  const creds = await loadOrgPayPal(doc.organization_id as string);
  if (!creds) return { ok: false, error: "finance.onlineUnavailable" };
  const locale = input.locale === "ar" || input.locale === "en" ? input.locale : "he";
  const app = publicEnv.appUrl.replace(/\/$/, "");
  const org = (doc.organizations as unknown as { name: string } | null)?.name ?? "";
  try {
    const o = await createOrgPayPalOrder(creds, {
      amount: due,
      currency: doc.currency as string,
      docToken: input.token,
      description: `${org} #${doc.number}${doc.title ? ` — ${doc.title}` : ""}`,
      returnUrl: `${app}/api/pay/paypal/return?doc=${input.token}&locale=${locale}`,
      cancelUrl: `${app}/${locale}/q/${input.token}`,
      locale,
      brand: org || "Payment",
    });
    return { ok: true, redirect: o.approveUrl };
  } catch (e) {
    console.error("org paypal order failed", (e as Error).message);
    return { ok: false, error: "finance.onlineFailed" };
  }
}

/* ------------------------------------------- wave 15: one-tap reminder actions */
/** Runs a signed action link (task done / snooze, meeting confirm / cancel) after the button press. */
export async function performActAction(input: { token: string }): Promise<PublicResult> {
  const { verifyAct } = await import("@/lib/act-links");
  const p = verifyAct(input.token);
  if (!p) return { ok: false, error: "act.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `act:${p.k}:${p.id}`, p_limit: 20, p_window_seconds: 3600 });
  if (allowed === false) return { ok: false, error: "public.rateLimited" };
  if (p.k === "task") {
    if (!p.u || (p.a !== "done" && p.a !== "snooze")) return { ok: false, error: "act.invalid" };
    const { data: t } = await admin.from("tasks").select("id").eq("id", p.id).eq("organization_id", p.o).maybeSingle();
    if (!t) return { ok: false, error: "errors.notFound" };
    const { data, error } = await admin.rpc("task_reminder_action", { p_task: p.id, p_user: p.u, p_action: p.a, p_minutes: 15 });
    if (error) return { ok: false, error: "errors.generic" };
    const r = data as { ok: boolean; error?: string; title?: string };
    return r.ok ? { ok: true, message: p.a === "done" ? "act.taskDone" : "act.taskSnoozed", data: { title: r.title ?? "" } } : { ok: false, error: r.error === "closed" ? "act.taskClosed" : "errors.notFound" };
  }
  if (p.a !== "confirm" && p.a !== "cancel") return { ok: false, error: "act.invalid" };
  const { data: ap } = await admin.from("appointments").select("id, status, starts_at, title").eq("id", p.id).eq("organization_id", p.o).maybeSingle();
  if (!ap) return { ok: false, error: "errors.notFound" };
  if (!["scheduled", "confirmed"].includes(ap.status as string)) return { ok: false, error: "act.apptClosed" };
  if (new Date(ap.starts_at as string).getTime() < Date.now()) return { ok: false, error: "act.apptPast" };
  const status = p.a === "confirm" ? "confirmed" : "canceled";
  const { error } = await admin.from("appointments").update({ status }).eq("id", p.id).eq("organization_id", p.o);
  if (error) return { ok: false, error: "errors.generic" };
  await admin.from("activities").insert({ organization_id: p.o, type: `appointment.${status}_by_customer`, payload: { appointment_id: p.id, title: ap.title } }).then(() => undefined, () => undefined);
  kickJobs();
  return { ok: true, message: p.a === "confirm" ? "act.apptConfirmed" : "act.apptCanceled", data: { title: (ap.title as string) ?? "" } };
}

/** Wave 16 — "this article helped" on the public help center. */
export async function markArticleHelpful(input: { id: string }): Promise<PublicResult> {
  if (!/^[0-9a-f-]{36}$/.test(input.id)) return { ok: false, error: "errors.notFound" };
  if (await throttled(`kb-helpful:${input.id}`, 3, 3600)) return { ok: true }; // silently ignore repeat votes
  await createAnonClient().rpc("kb_article_helpful", { p_id: input.id });
  return { ok: true };
}
