import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { emailConfigured, escapeHtml, sendEmail } from "@/lib/email/send";

/**
 * Payments are recorded once per provider event with a sequential receipt
 * number; the payer gets a receipt e-mail with a link to the printable receipt.
 */

export interface PaymentInput {
  orgId: string;
  provider: "stripe" | "paypal" | "lemonsqueezy" | "nowpayments" | "manual";
  externalId: string;
  plan: string | null;
  interval: "month" | "year" | null;
  amount: number;
  currency: string;
  email?: string | null;
  name?: string | null;
  periodEnd?: string | null;
  meta?: Record<string, unknown>;
}

export function businessDetails() {
  return {
    name: process.env.BILLING_BUSINESS_NAME || "Super Coder Cloud",
    id: process.env.BILLING_BUSINESS_ID || "",
    address: process.env.BILLING_BUSINESS_ADDRESS || "",
    email: process.env.BILLING_BUSINESS_EMAIL || process.env.NEXT_PUBLIC_SALES_EMAIL || "",
  };
}

export async function recordPayment(p: PaymentInput): Promise<{ id: string; receipt_number: number; new: boolean } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_billing_payment", {
    p_org: p.orgId,
    p_provider: p.provider,
    p_external: p.externalId,
    p_plan: p.plan,
    p_interval: p.interval,
    p_amount: p.amount,
    p_currency: p.currency,
    p_email: p.email ?? null,
    p_name: p.name ?? null,
    p_period_end: p.periodEnd ?? null,
    p_meta: p.meta ?? {},
  });
  if (error || !data) {
    console.error("record payment failed", error?.message);
    return null;
  }
  const r = data as { id: string; receipt_number: number; new: boolean };
  if (r.new) await emailReceipt(p, r).catch(() => {});
  return r;
}

async function emailReceipt(p: PaymentInput, r: { id: string; receipt_number: number }) {
  if (!emailConfigured()) return;
  const admin = createAdminClient();
  let to = p.email ?? null;
  if (!to) {
    const { data: owner } = await admin.from("organization_members").select("user_id").eq("organization_id", p.orgId).eq("role", "owner").limit(1).maybeSingle();
    if (owner) {
      const { data: prof } = await admin.from("profiles").select("email").eq("id", owner.user_id).maybeSingle();
      to = (prof?.email as string | undefined) ?? null;
    }
  }
  if (!to) return;
  const b = businessDetails();
  const link = `${publicEnv.appUrl.replace(/\/$/, "")}/he/receipt/${r.id}`;
  const amount = `${p.amount.toFixed(2)} ${p.currency.toUpperCase()}`;
  const plan = p.plan ? p.plan.charAt(0).toUpperCase() + p.plan.slice(1) : "";
  const rows = [
    ["מספר קבלה", `#${r.receipt_number}`],
    ["תאריך", new Date().toLocaleDateString("he-IL")],
    ["מסלול", `${plan}${p.interval ? ` · ${p.interval === "year" ? "שנתי" : "חודשי"}` : ""}`],
    ["סכום", amount],
    ["אמצעי תשלום", { paypal: "PayPal / כרטיס אשראי", lemonsqueezy: "כרטיס אשראי (Lemon Squeezy)", nowpayments: "מטבע דיגיטלי", stripe: "כרטיס אשראי (Stripe)", manual: "ידני" }[p.provider]],
  ];
  const html = `<!doctype html><html dir="rtl"><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f2">
<tr><td style="background:#3366E6;color:#fff;padding:20px 24px;font-size:18px;font-weight:700;text-align:right">${escapeHtml(b.name)} · קבלה #${r.receipt_number}</td></tr>
<tr><td style="padding:24px;color:#1d2433;font-size:15px;line-height:1.6;text-align:right">
<p style="margin:0 0 16px">תודה! התשלום התקבל והמסלול שלכם פעיל. ✅</p>
<table role="presentation" width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="border-bottom:1px solid #eef0f6;color:#667085">${escapeHtml(String(k))}</td><td style="border-bottom:1px solid #eef0f6;font-weight:600">${escapeHtml(String(v))}</td></tr>`).join("")}
</table>
<p style="margin:20px 0 0"><a href="${link}" style="display:inline-block;background:#3366E6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px">לצפייה והדפסה של הקבלה</a></p>
${b.id || b.address ? `<p style="margin:20px 0 0;color:#98a2b3;font-size:12px">${escapeHtml([b.name, b.id, b.address].filter(Boolean).join(" · "))}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = `${b.name} — קבלה #${r.receipt_number}\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${link}`;
  await sendEmail({ to, subject: `קבלה #${r.receipt_number} · ${b.name}`, html, text });
}

/** Activates (or updates) the plan from a verified provider event. */
export async function applyPlan(input: {
  orgId: string;
  plan: string;
  status: string;
  provider: "paypal" | "lemonsqueezy" | "nowpayments";
  customer?: string | null;
  subscription?: string | null;
  interval?: "month" | "year" | null;
  periodEnd?: string | null;
  cancel?: boolean;
}) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("apply_subscription", {
    p_org: input.orgId,
    p_plan: input.plan,
    p_status: input.status,
    p_provider: input.provider,
    p_customer: input.customer ?? null,
    p_subscription: input.subscription ?? null,
    p_interval: input.interval ?? null,
    p_period_end: input.periodEnd ?? null,
    p_cancel: Boolean(input.cancel),
  });
  if (error) throw new Error(error.message);
}

/** Plan price in a currency: plan currency (ILS) or the USD columns. */
export async function planPrice(plan: string, interval: "month" | "year", usd = false): Promise<{ amount: number; currency: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("plans").select("price_monthly, price_yearly, price_monthly_usd, price_yearly_usd, currency").eq("key", plan).maybeSingle();
  if (!data) return null;
  if (usd) {
    const a = Number(interval === "year" ? data.price_yearly_usd : data.price_monthly_usd);
    return a > 0 ? { amount: a, currency: "USD" } : null;
  }
  const a = Number(interval === "year" ? data.price_yearly : data.price_monthly);
  return a > 0 ? { amount: a, currency: String(data.currency ?? "ILS").toUpperCase() } : null;
}
