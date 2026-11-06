/**
 * Billing integrity (pure, unit-tested) — what the platform admin must look at for each business.
 *   paid_no_access     a paying subscription (in its period) but the business is on another plan → "fix" restores it
 *   access_no_payment  a paid plan with no live subscription behind it (cancelled / unpaid / none) → check by hand
 *   past_due           the last payment failed (the plan stays for a 7-day grace after the period, then ends by itself)
 *   period_passed      an active subscription whose period ended more than a day ago without a renewal event
 *   no_receipts        a paid, non-manual plan that has no recorded payment at all
 *   over_limit         used more AI credits this month than the plan allows, with no pack balance left
 */
export type BillingFlag = "paid_no_access" | "access_no_payment" | "past_due" | "period_passed" | "no_receipts" | "over_limit";

export interface BillingHealthRow {
  organization_id: string;
  name: string;
  owner_email: string | null;
  plan: string;
  is_demo: boolean;
  sub_plan: string | null;
  sub_status: string | null;
  sub_provider: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
  paid_total: number;
  paid_currency: string | null;
  payments: number;
  last_paid_at: string | null;
  credits_month: number;
  monthly_limit: number | null;
  pack_balance: number;
}

const LIVE = ["active", "trialing", "past_due"];

export function billingFlags(r: BillingHealthRow, now = Date.now()): BillingFlag[] {
  const out: BillingFlag[] = [];
  const end = r.period_end ? Date.parse(r.period_end) : null;
  const inPeriod = end === null || end > now;
  const live = !!r.sub_status && LIVE.includes(r.sub_status);
  if (live && inPeriod && r.sub_plan && r.sub_plan !== "free" && r.plan !== r.sub_plan) out.push("paid_no_access");
  if (r.plan !== "free" && !r.is_demo && (!r.sub_status || !LIVE.includes(r.sub_status))) out.push("access_no_payment");
  if (r.sub_status === "past_due") out.push("past_due");
  if ((r.sub_status === "active" || r.sub_status === "trialing") && end !== null && end < now - 86_400_000) out.push("period_passed");
  if (r.plan !== "free" && !r.is_demo && r.sub_provider && r.sub_provider !== "manual" && Number(r.payments) === 0) out.push("no_receipts");
  if (r.monthly_limit !== null && Number(r.credits_month) > Number(r.monthly_limit) && Number(r.pack_balance) <= 0) out.push("over_limit");
  return out;
}

/** "fix" is only offered when something can be fixed automatically */
export const AUTO_FIXABLE: BillingFlag[] = ["paid_no_access", "past_due", "period_passed"];

export function summarize(rows: BillingHealthRow[], now = Date.now()) {
  const flagged = rows.map((r) => ({ row: r, flags: billingFlags(r, now) }));
  return {
    total: rows.length,
    paying: rows.filter((r) => r.plan !== "free" && !r.is_demo).length,
    issues: flagged.filter((f) => f.flags.length > 0).length,
    fixable: flagged.filter((f) => f.flags.some((x) => AUTO_FIXABLE.includes(x))).length,
    flagged,
  };
}
