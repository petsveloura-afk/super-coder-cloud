import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { deletionCode, parseSignedRequest } from "@/lib/legal/meta-signed-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/meta/data-deletion — Meta's "Data deletion request URL" (Facebook Login for Business and Instagram Login).
 * Meta sends a signed_request when a person asks to delete their data; we answer with a status page address and a
 * confirmation code, as Meta requires: { url, confirmation_code }. The page: /{locale}/legal/data-deletion?request=CODE
 */
export async function POST(request: NextRequest) {
  let signed = "";
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) signed = String(((await request.json()) as { signed_request?: string }).signed_request ?? "");
    else signed = String((await request.formData()).get("signed_request") ?? "");
  } catch {
    signed = "";
  }
  // Meta's HMAC-SHA256 signature is verified with the platform's app secrets — an unsigned or tampered request is refused
  const payload = parseSignedRequest(signed, [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET, process.env.META_PAGES_APP_SECRET]);
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const code = deletionCode(payload.user_id, Date.now());
  const { handleMetaUserRemoval } = await import("@/lib/legal/meta-callbacks");
  await handleMetaUserRemoval("deletion", payload.user_id, code).catch((e) => console.error("meta data deletion failed", (e as Error).message));
  const url = `${publicEnv.appUrl.replace(/\/$/, "")}/en/legal/data-deletion?request=${encodeURIComponent(code)}`;
  return NextResponse.json({ url, confirmation_code: code }, { headers: { "Cache-Control": "no-store" } });
}

/** a reviewer opening the address in a browser lands on the instructions page */
export async function GET() {
  return NextResponse.redirect(`${publicEnv.appUrl.replace(/\/$/, "")}/he/legal/data-deletion`, 307);
}
