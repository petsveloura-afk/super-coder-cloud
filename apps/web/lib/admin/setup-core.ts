/**
 * Wave 20 — the platform's one-time setup, step by step (admin console).
 * Each connection that needs the platform owner's own app lists exactly which Vercel variables
 * are missing, the addresses to paste at the provider, and where to click. After a step is done,
 * every business on the platform connects that service in one click.
 * Pure (no I/O) — unit-tested; the live checks live in lib/admin/setup.ts.
 */
export type SetupKey = "bridge" | "meta_app" | "wa_official" | "meta_pages" | "google" | "shopify";

export interface SetupStep {
  key: SetupKey;
  done: boolean;
  /** variables to add in Vercel → Settings → Environment Variables */
  vars: { name: string; set: boolean; secret: boolean }[];
  /** addresses to paste at the provider */
  copies: { label: string; value: string }[];
  links: { label: string; href: string }[];
  /** a step that only makes sense after another one */
  needs?: SetupKey;
}

type Env = Record<string, string | undefined>;

const has = (env: Env, k: string, min = 1) => (env[k] ?? "").trim().length >= min;

export function setupSteps(env: Env, appUrl: string): SetupStep[] {
  const base = appUrl.replace(/\/$/, "");
  const v = (name: string, secret = false, min = 1) => ({ name, set: has(env, name, min), secret });
  const steps: SetupStep[] = [
    {
      key: "bridge",
      vars: [v("WA_BRIDGE_URL"), v("WA_BRIDGE_SECRET", true, 24)],
      copies: [{ label: "APP_URL (Railway)", value: base }],
      links: [{ label: "Railway", href: "https://railway.com/dashboard" }],
      done: false,
    },
    {
      key: "meta_app",
      vars: [v("META_APP_ID"), v("META_APP_SECRET", true, 16)],
      copies: [{ label: "App domain", value: base.replace(/^https?:\/\//, "") }],
      links: [
        { label: "Meta for Developers", href: "https://developers.facebook.com/apps" },
        { label: "Business verification", href: "https://business.facebook.com/settings/security" },
      ],
      done: false,
    },
    {
      key: "wa_official",
      needs: "meta_app",
      vars: [v("META_WA_CONFIG_ID"), v("META_WEBHOOK_VERIFY_TOKEN", true, 8)],
      copies: [{ label: "Webhook (WhatsApp)", value: `${base}/api/channels/meta/whatsapp` }],
      links: [{ label: "WhatsApp Embedded Signup", href: "https://developers.facebook.com/docs/whatsapp/embedded-signup" }],
      done: false,
    },
    {
      key: "meta_pages",
      needs: "meta_app",
      vars: [v("META_PAGES_CONFIG_ID"), v("META_WEBHOOK_VERIFY_TOKEN", true, 8)],
      copies: [{ label: "Webhook (Messenger + Instagram)", value: `${base}/api/channels/meta/pages` }],
      links: [{ label: "Facebook Login for Business", href: "https://developers.facebook.com/docs/facebook-login/facebook-login-for-business" }],
      done: false,
    },
    {
      key: "google",
      vars: [v("GOOGLE_CLIENT_ID"), v("GOOGLE_CLIENT_SECRET", true)],
      copies: [
        { label: "Redirect URI", value: `${base}/api/google/callback` },
        { label: "Redirect URI (Gmail)", value: `${base}/api/oauth/google/callback` },
      ],
      links: [{ label: "Google Cloud Console", href: "https://console.cloud.google.com/apis/credentials" }],
      done: false,
    },
    {
      key: "shopify",
      vars: [v("SHOPIFY_CLIENT_ID"), v("SHOPIFY_CLIENT_SECRET", true)],
      copies: [
        { label: "App URL", value: `${base}/he/integrations` },
        { label: "Redirect URL", value: `${base}/api/stores/shopify/callback` },
      ],
      links: [{ label: "Shopify Partners", href: "https://partners.shopify.com" }],
      done: false,
    },
  ];
  for (const s of steps) s.done = s.vars.every((x) => x.set);
  return steps;
}

export function setupProgress(steps: SetupStep[]) {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, pct: Math.round((done / Math.max(1, steps.length)) * 100) };
}
