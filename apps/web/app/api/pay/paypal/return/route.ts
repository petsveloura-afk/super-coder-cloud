import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/pay/paypal/return?doc=<document token>&locale=he&token=<PayPal order id>
 * Wave 15 — the customer approved a payment in the business's own PayPal account:
 * capture it with the business's credentials, check the order belongs to this
 * document and the amount is not more than the open balance, record the payment
 * (idempotent by capture id) and return to the document page.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const doc = sp.get("doc") ?? "";
  const orderId = sp.get("token") ?? "";
  const locale = ["he", "ar", "en"].includes(sp.get("locale") ?? "") ? (sp.get("locale") as string) : "he";
  const back = (q: string) => NextResponse.redirect(new URL(`/${locale}/q/${doc}${q}`, request.url), 303);
  if (!/^[a-f0-9]{32}$/.test(doc) || !/^[A-Z0-9]{8,40}$/.test(orderId)) return back("");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return back("?paid=0");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { loadOrgPayPal, captureOrgPayPalOrder } = await import("@/lib/finance/org-paypal");
  const admin = createAdminClient();
  const { data: d } = await admin.from("documents").select("organization_id, total, amount_paid, currency, kind").eq("public_token", doc).maybeSingle();
  if (!d || d.kind !== "invoice") return back("");
  const creds = await loadOrgPayPal(d.organization_id as string);
  if (!creds) return back("?paid=0");
  try {
    const cap = await captureOrgPayPalOrder(creds, orderId);
    const open = Math.round((Number(d.total) - Number(d.amount_paid)) * 100) / 100;
    if (cap.status !== "COMPLETED" || cap.docToken !== doc || !cap.captureId) return back("?paid=0");
    // a refresh of this page after the payment was recorded
    const { data: seen } = await admin.from("payments").select("id").eq("external_id", `pp_${cap.captureId}`).maybeSingle();
    if (seen) return back("?paid=1");
    if (cap.currency.toUpperCase() !== String(d.currency).toUpperCase() || !(cap.amount > 0) || cap.amount > open + 0.01) {
      console.error("org paypal: amount/currency mismatch", { amount: cap.amount, open, currency: cap.currency });
      return back("?paid=0");
    }
    const { error } = await admin.rpc("record_online_payment_v2", { p_token: doc, p_amount: cap.amount, p_external_id: `pp_${cap.captureId}`, p_method: "paypal" });
    if (error) console.error("record paypal payment failed", error.message);
    const { kickJobs } = await import("@/lib/jobs/kick");
    kickJobs();
    return back("?paid=1");
  } catch (e) {
    console.error("org paypal capture failed", (e as Error).message);
    return back("?paid=0");
  }
}
