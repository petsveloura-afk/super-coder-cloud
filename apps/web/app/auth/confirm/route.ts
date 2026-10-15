import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/env";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

/**
 * Handles Supabase email links (signup verification, password recovery,
 * magic links) and OAuth callbacks. `next` is restricted to same-origin paths.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeRedirectPath(url.searchParams.get("next"), `/${DEFAULT_LOCALE}/overview`);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    const locale = next.split("/")[1] || DEFAULT_LOCALE;
    return NextResponse.redirect(new URL(`/${locale}/login?error=link`, request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
