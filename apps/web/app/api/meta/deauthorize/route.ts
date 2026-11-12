import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { parseSignedRequest } from "@/lib/legal/meta-signed-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/meta/deauthorize — Meta's "Deauthorize callback URL" (Facebook Login for Business and Instagram Login).
 * A person removed the app from their Facebook / Instagram settings: the matching Instagram connection is switched off
 * (shown on the integrations screen with "connect again"), and the event is written to the audit log. Always 200 for a
 * valid request, so Meta does not retry.
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
  const { handleMetaUserRemoval } = await import("@/lib/legal/meta-callbacks");
  await handleMetaUserRemoval("deauthorize", payload.user_id, null).catch((e) => console.error("meta deauthorize failed", (e as Error).message));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.redirect(`${publicEnv.appUrl.replace(/\/$/, "")}/he/legal/privacy`, 307);
}
