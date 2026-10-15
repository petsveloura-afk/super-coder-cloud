import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { LOCALE_COOKIE, isLocale, negotiateLocale } from "@/lib/i18n/config";
import { updateSession } from "@/lib/supabase/proxy-session";

/** Routes reachable without a session (after the /{locale} prefix). */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/offline", "/setup"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, first = "", ...rest] = pathname.split("/");

  // 1) Ensure every page URL carries a supported locale prefix.
  if (!isLocale(first)) {
    const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookieLocale) ? cookieLocale : negotiateLocale(request.headers.get("accept-language"));
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

