import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = (() => {
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return "";
  }
})();
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

// wave 13: PayPal's card form (JS SDK) is allowed on every page — after an in-app navigation
// the browser keeps the first page's policy, so billing / the website editor must not depend
// on their own page headers (script-src already allows inline scripts, PayPal adds no risk).
const paypalSdkOrigin = (() => {
  try {
    return process.env.PAYPAL_SDK_URL ? new URL(process.env.PAYPAL_SDK_URL).origin : "";
  } catch {
    return "";
  }
})();
const paypalGlobal = `https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com https://*.paypalobjects.com https://*.braintreegateway.com ${paypalSdkOrigin}`.trim();

// Strict-by-default CSP. 'unsafe-inline' for styles is required by Next/Tailwind
// runtime style injection; scripts are limited to self (+ inline bootstrap).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  // wave 13: published websites (also on custom domains, where the path is "/") show
  // https images, Google Fonts and YouTube / Vimeo videos
  `img-src 'self' data: blob: https: ${supabaseOrigin}`.trim(),
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com ${paypalGlobal}`,
  `script-src 'self' 'unsafe-inline' ${paypalGlobal}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ${paypalGlobal}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  // wave 14: in production (https) every sub-request is forced to https
  ...((process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // wave 14: extra hardening
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// Public forms and booking pages may be embedded (iframe) on customers' websites.
// CSP frame-ancestors overrides X-Frame-Options in all modern browsers.
const embeddableCsp = csp.replace("frame-ancestors 'none'", "frame-ancestors *");
const embeddableHeaders = [{ key: "Content-Security-Policy", value: embeddableCsp }];

// Published websites (/s) may show images hosted anywhere over https (hero images).
const siteCsp = csp.replace("img-src 'self'", "img-src 'self' https:");
const siteHeaders = [{ key: "Content-Security-Policy", value: siteCsp }];

// Integrations: Meta "Connect WhatsApp" popup (Facebook JS SDK) is allowed on this page only.
const integrationsCsp = csp
  .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://connect.facebook.net")
  .replace(/connect-src ([^;]*)/, "connect-src $1 https://graph.facebook.com https://www.facebook.com")
  .replace(/frame-src ([^;]*)/, "frame-src $1 https://www.facebook.com https://web.facebook.com https://business.facebook.com");
const integrationsHeaders = [
  { key: "Content-Security-Policy", value: integrationsCsp },
  // wave 25: with COOP "same-origin" the Facebook popup loses its link to this page, so the SDK reports "popup blocked"
  // although nothing is blocked. "same-origin-allow-popups" keeps the popup connected (same as billing / PayPal).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

// Billing: PayPal's card form (JS SDK) runs inside the page — allowed on this page only.
const paypalExtra = (() => {
  try {
    return process.env.PAYPAL_SDK_URL ? new URL(process.env.PAYPAL_SDK_URL).origin : "";
  } catch {
    return "";
  }
})();
const paypalHosts = `https://www.paypal.com https://*.paypal.com https://www.paypalobjects.com https://*.paypalobjects.com https://*.braintreegateway.com ${paypalExtra}`.trim();
const billingCsp = csp
  .replace("script-src 'self' 'unsafe-inline'", `script-src 'self' 'unsafe-inline' ${paypalHosts}`)
  .replace(/connect-src ([^;]*)/, `connect-src $1 ${paypalHosts}`)
  .replace(/img-src ([^;]*)/, `img-src $1 ${paypalHosts}`)
  .replace("form-action 'self'", `form-action 'self' ${paypalHosts}`)
  .replace(/frame-src ([^;]*)/, `frame-src $1 ${paypalHosts}`);
const billingHeaders = [
  { key: "Content-Security-Policy", value: billingCsp },
  // PayPal may open a small secure window for some cards / 3-D Secure
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://www.paypal.com\")" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // node-only mail libraries (IMAP / SMTP / MIME) stay external to the server bundle
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
  // agent gallery uploads (images are also resized in the browser first)
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  poweredByHeader: false,
  transpilePackages: ["@scc/shared", "@scc/database"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/:locale(he|ar|en)/f/:slug*", headers: embeddableHeaders },
      { source: "/:locale(he|ar|en)/book/:slug*", headers: embeddableHeaders },
      { source: "/:locale(he|ar|en)/s/:slug*", headers: siteHeaders },
      // embeddable website chat (iframe from /widget.js on customers' sites)
      { source: "/:locale(he|ar|en)/chat/:org*", headers: embeddableHeaders },
      { source: "/:locale(he|ar|en)/integrations", headers: integrationsHeaders },
      { source: "/:locale(he|ar|en)/billing", headers: billingHeaders },
      // wave 14: the checkout page (card form + 3-D Secure pop-ups)
      { source: "/:locale(he|ar|en)/billing/:path*", headers: billingHeaders },
      // wave 13: buying a domain for a website — the same in-page card form
      { source: "/:locale(he|ar|en)/websites/:id", headers: billingHeaders },
      { source: "/widget.js", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }, { key: "Access-Control-Allow-Origin", value: "*" }] },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
