import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase auth session inside proxy.ts and returns the user.
 * Uses getClaims(): with asymmetric JWT signing keys (default for new Supabase
 * projects) the token signature is verified locally against the cached JWKS —
 * no Auth round-trip per request. With a symmetric secret it falls back to a
 * server check (same as getUser). Expired tokens are refreshed first.
 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  let res = response;
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const headers = new Headers(res.headers);
        res = NextResponse.next({ request, headers });
        for (const { name, value, options } of cookiesToSet) res.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  const user = typeof sub === "string" && sub ? { id: sub } : null;
  return { response: res, user };
}
