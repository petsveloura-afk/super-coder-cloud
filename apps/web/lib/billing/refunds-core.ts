/**
 * Round 12 — billing refunds / chargebacks (pure, unit-tested).
 *
 * PayPal tells us about money going back with: PAYMENT.CAPTURE.REFUNDED (a refund of a one-time payment — the resource
 * is the refund, its "up" link points to the capture), PAYMENT.CAPTURE.REVERSED (a chargeback — the resource is the
 * capture), PAYMENT.SALE.REFUNDED / PAYMENT.SALE.REVERSED (a subscription payment — the resource carries sale_id).
 * Our payments are stored with these external ids: "paypal:<capture>" (credit packs), "capture:<capture>" (a plan paid by
 * card), "<sale id>" (subscription payment), "<subscription>:<time>" (the subscription sync twin).
 */

export const REFUND_EVENTS = ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"] as const;

export function isRefundEvent(type: string): boolean {
  return (REFUND_EVENTS as readonly string[]).includes(type);
}

interface RefundResource {
  id?: unknown;
  sale_id?: unknown;
  links?: { rel?: string; href?: string }[] | unknown;
  amount?: { value?: unknown; total?: unknown; currency_code?: unknown; currency?: unknown } | unknown;
}

const clean = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{6,80}$/.test(v) ? v : null);

/** the provider ids of the ORIGINAL payment this event is about */
export function refundedPaymentIds(type: string, resource: RefundResource | null | undefined): string[] {
  const r = resource ?? {};
  const ids = new Set<string>();
  if (type === "PAYMENT.CAPTURE.REVERSED") {
    const id = clean(r.id);
    if (id) ids.add(id);
  }
  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    for (const l of Array.isArray(r.links) ? (r.links as { rel?: string; href?: string }[]) : []) {
      if (l?.rel === "up" && typeof l.href === "string") {
        const m = l.href.match(/\/captures\/([A-Za-z0-9-]{6,80})(?:$|[/?#])/);
        if (m) ids.add(m[1]!);
      }
    }
  }
  if (type.startsWith("PAYMENT.SALE.")) {
    const sale = clean(r.sale_id) ?? (type === "PAYMENT.SALE.REVERSED" ? clean(r.id) : null);
    if (sale) ids.add(sale);
  }
  return [...ids];
}

/** the stored external ids that can belong to a provider id */
export function storedIdsFor(providerId: string): string[] {
  return [providerId, `paypal:${providerId}`, `capture:${providerId}`];
}

export function refundAmount(resource: RefundResource | null | undefined): { amount: number | null; currency: string | null } {
  const a = ((resource ?? {}) as RefundResource).amount as { value?: unknown; total?: unknown; currency_code?: unknown; currency?: unknown } | undefined;
  const n = Number(a?.value ?? a?.total);
  const c = a?.currency_code ?? a?.currency;
  return { amount: Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null, currency: typeof c === "string" ? c.toUpperCase() : null };
}

/** full refund (the money back covers the payment) vs. a partial one — credits are taken back only on a full refund / chargeback */
export function isFullRefund(type: string, paid: number, refunded: number | null): boolean {
  if (type.endsWith(".REVERSED")) return true;
  if (refunded === null) return true;
  return refunded + 0.01 >= paid;
}
