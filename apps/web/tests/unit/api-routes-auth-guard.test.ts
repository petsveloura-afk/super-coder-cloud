import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Permanent security guard (additive): EVERY API route proves who is calling — a server secret (cron), a provider signature /
 * per-account webhook token, the signed-in session, the public-API key — or is on the short, reviewed list of routes that are
 * public by design (each with the reason). A new route without any of these fails this test.
 */
const root = join(__dirname, "../..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === "route.ts") out.push(p);
  }
  return out;
};

const REVIEWED_PUBLIC: Record<string, string> = {
  "app/api/public/v1/openapi.json/route.ts": "the public API's documentation (no data)",
  "app/api/site/track/route.ts": "anonymous website analytics — random visitor id, size-limited, rate limited per visitor in the database",
  "app/api/voice/clip/[id]/route.ts": "an unguessable clip id that expires after 30 minutes (Twilio <Play>)",
  "app/api/billing/paypal/return/route.ts": "PayPal's return page — the subscription is re-read from PayPal server to server, the URL is never trusted",
  "app/api/billing/paypal/domain-return/route.ts": "PayPal's return page — the order is captured server to server, the URL is never trusted",
  "app/api/billing/paypal/order-return/route.ts": "PayPal's return page — the order is captured server to server, the URL is never trusted",
  "app/api/billing/paypal/pack-return/route.ts": "PayPal's return page — the order is captured server to server, the URL is never trusted",
  "app/api/pay/paypal/return/route.ts": "PayPal's return page — the payment is verified server to server, the URL is never trusted",
  "app/api/chat/[org]/route.ts": "the public website chat widget — rate limited per visitor and per IP (public_rate_limit)",
  "app/api/errors/route.ts": "browser crash reports — rate limited per IP, personal data redacted",
  "app/api/stores/woocommerce/callback/route.ts": "WooCommerce's key callback — accepted only for OUR pending integration id, within one hour",
  "app/api/unsubscribe/[token]/route.ts": "RFC 8058 one-click unsubscribe — an unguessable per-recipient token",
};

const AUTH = [
  /CRON_SECRET|cronRoute\(|authorized\(/, // server secret
  /getOrgContext|auth\.getUser|getUser\(|requirePlatformAdmin/, // signed-in session
  /verify\w*Signature|signature|hmac|timingSafeEqual|webhook_token|validRecordingSig|platformVoiceRequest/i, // provider signature / token
  /authenticate\(request/, // public API key
  /createClient\(\)/, // the signed-in person's session (RLS decides what they may read)
  /params: Promise<\{ token: string \}>/, // a per-account secret webhook token in the path (checked against the account)
  /twilioVoiceRequest|platformVoiceRequest/, // Twilio signature
];

describe("every API route proves who is calling", () => {
  it("no unauthenticated route outside the reviewed public list", () => {
    const bad: string[] = [];
    for (const f of walk(join(root, "app/api"))) {
      const rel = relative(root, f).replace(/\\/g, "/");
      if (REVIEWED_PUBLIC[rel]) continue;
      const src = readFileSync(f, "utf8");
      if (!AUTH.some((r) => r.test(src))) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});
