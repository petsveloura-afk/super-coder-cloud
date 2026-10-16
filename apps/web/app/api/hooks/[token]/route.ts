import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { kickJobs } from "@/lib/jobs/kick";

export const dynamic = "force-dynamic";

/**
 * POST /api/hooks/{token} — inbound webhook for an automation with the
 * "webhook.inbound" trigger (Zapier, Make, website forms, Facebook Lead Ads via
 * a connector…). Accepts JSON or form-encoded bodies (≤ 32 KB). If the body has
 * email/phone, the contact is matched or created (source "webhook").
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await request.text();
  if (raw.length > 32_768) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let body: unknown = {};
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(raw));
    else if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ingest_inbound_webhook", { p_token: token, p_body: body });
  if (error) {
    if (error.message.includes("not_found")) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (error.message.includes("rate_limited")) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (error.message.includes("payload_too_large")) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    console.error("inbound webhook failed", error.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  kickJobs();
  return NextResponse.json(data, { status: (data as { ok?: boolean })?.ok === false ? 409 : 200 });
}
