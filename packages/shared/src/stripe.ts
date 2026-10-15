import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification (server-only, no SDK).
 * Header format: "t=1700000000,v1=<hex hmac>[,v1=...]"
 * Signed payload: `${t}.${rawBody}` with HMAC-SHA256 and the endpoint secret.
 * Rejects stale timestamps (default tolerance 5 minutes) to stop replays.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return signatures.some((sig) => {
    if (!/^[a-f0-9]{64}$/.test(sig)) return false;
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Build a valid header (used by tests and local webhook replays). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

/** application/x-www-form-urlencoded with Stripe's nested key syntax: a[b][c]=v */
export function stripeForm(params: Record<string, unknown>, prefix = ""): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") out.push(stripeForm(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      out.push(stripeForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.filter(Boolean).join("&");
}
