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

// Strict-by-default CSP. 'unsafe-inline' for styles is required by Next/Tailwind
// runtime style injection; scripts are limited to self (+ inline bootstrap).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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
  .concat("; frame-src https://www.facebook.com https://web.facebook.com https://business.facebook.com");
const integrationsHeaders = [{ key: "Content-Security-Policy", value: integrationsCsp }];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // node-only mail libraries (IMAP / SMTP / MIME) stay external to the server bundle
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
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
