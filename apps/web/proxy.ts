import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { LOCALE_COOKIE, firstVisitLocale, isLocale } from "@/lib/i18n/config";
import { updateSession } from "@/lib/supabase/proxy-session";

/** Routes reachable without a session (after the /{locale} prefix). */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/offline", "/setup", "/f", "/book", "/c", "/s", "/q", "/help", "/t", "/chat"];

/* ---------------- wave 13: websites on their own domain / subdomain ---------------- */
const hostCache = new Map<string, { at: number; v: { slug: string; lang: string } | null }>();
function ownHosts(): Set<string> {
  const out = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  for (const u of [process.env.NEXT_PUBLIC_APP_URL, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "", process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""]) {
    try {
      if (u) out.add(new URL(u).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return out;
}
const SITE_LEGAL = /^\/(privacy|terms|accessibility|cookies)\/?$/;
async function siteForHost(host: string): Promise<{ slug: string; lang: string } | null> {
  if (!host || ownHosts().has(host) || host.endsWith(".vercel.app") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  // https://{slug}.{SITES_ROOT_DOMAIN} (wildcard domain on the project)
  const root = (process.env.SITES_ROOT_DOMAIN ?? "").toLowerCase().replace(/^\.+/, "");
  if (root && host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    return /^[a-z0-9][a-z0-9-]{2,60}$/.test(sub) ? { slug: sub, lang: process.env.SITES_DEFAULT_LANG ?? "he" } : null;
  }
  const hit = hostCache.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: { slug: string; lang: string } | null = null;
  try {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (base && key) {
      const r = await fetch(`${base}/rest/v1/rpc/site_slug_for_host`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_host: host }),
        signal: AbortSignal.timeout(4000),
      });
      const rows = r.ok ? ((await r.json()) as { slug: string; lang: string }[]) : [];
      v = rows[0]?.slug ? { slug: rows[0].slug, lang: isLocale(rows[0].lang) ? rows[0].lang : "he" } : null;
    }
  } catch {
    v = null;
  }
  if (hostCache.size > 500) hostCache.clear();
  hostCache.set(host, { at: Date.now(), v });
  return v;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // wave 13: a published website on its own domain — "/" and its legal pages are served from /{lang}/s/{slug}
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase().split(":")[0]!.trim();
  if (pathname === "/" || SITE_LEGAL.test(pathname)) {
    const site = await siteForHost(host);
    if (site) {
      const url = request.nextUrl.clone();
      url.pathname = `/${site.lang}/s/${site.slug}${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
      const h = new Headers(request.headers);
      h.set("x-scc-site-host", host);
      return NextResponse.rewrite(url, { request: { headers: h } });
    }
  }

  const [, first = "", ...rest] = pathname.split("/");

  // 1) Ensure every page URL carries a supported locale prefix.
  if (!isLocale(first)) {
    const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookieLocale) ? cookieLocale : firstVisitLocale(request.headers.get("accept-language"));
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  const locale = first;
  const subPath = `/${rest.join("/")}`.replace(/\/$/, "") || "/";
  let response = NextResponse.next({ request });
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });

  // 2) Without Supabase configuration, route everything to the setup screen.
  if (!isSupabaseConfigured()) {
    if (subPath !== "/setup" && subPath !== "/offline") {
      return NextResponse.redirect(new URL(`/${locale}/setup`, request.url));
    }
    return response;
  }

  // 3) Refresh session and gate private routes.
  const session = await updateSession(request, response);
  response = session.response;
  response.cookies.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });

  const isPublic = PUBLIC_PATHS.some((p) => subPath === p || subPath.startsWith(`${p}/`));
  if (!session.user && !isPublic) {
    const url = new URL(`/${locale}/login`, request.url);
    if (subPath !== "/") url.searchParams.set("next", `/${locale}${subPath === "/" ? "" : subPath}${search}`);
    return NextResponse.redirect(url);
  }
  if (session.user && (subPath === "/login" || subPath === "/signup")) {
    return NextResponse.redirect(new URL(`/${locale}/overview`, request.url));
  }
  return response;
}

export const config = {
  // Skip API routes, auth callbacks, Next internals and static assets.
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons|offline.html|.*\\.(?:png|svg|jpg|jpeg|webp|ico|txt|xml|js|css|woff2?)$).*)"],
};

