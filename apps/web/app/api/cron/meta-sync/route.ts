import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET|POST /api/cron/meta-sync — wave 44: Facebook / Instagram direct messages on a server clock.
 * Called every 30 seconds by Supabase pg_cron (see migration 20261029000002) or any other scheduler.
 * Fetches the unanswered messages of every connected Page (1 Graph call per account) through the same pipeline as the
 * webhook, so the agent answers within seconds even when Meta's webhook is late and nobody has the inbox open.
 * Bearer CRON_SECRET.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  // two overlapping callers (pg_cron + the 5-minute sweep) never both run: one run per 20 seconds
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: "metasync:cron", p_limit: 1, p_window_seconds: 20 });
  if (allowed === false) return NextResponse.json({ ok: true, throttled: true });
  const full = request.nextUrl.searchParams.get("full") === "1";
  const { syncMetaInbound } = await import("@/lib/channels/meta-sync");
  const result = await syncMetaInbound(40_000, { fast: !full }).catch((e) => ({ error: (e as Error).message }));
  if (Math.random() < 0.02) await import("@/lib/channels/meta-webhook-log").then((m) => m.purgeMetaWebhookLog(3));
  return NextResponse.json({ ok: true, metaSync: result }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
