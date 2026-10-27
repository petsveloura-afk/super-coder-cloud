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

/** GET|POST /api/cron/social — wave 35: ONLY the due social posts (fast, runs first every 5 minutes). Bearer CRON_SECRET. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const { publishDuePosts } = await import("@/lib/social/publish");
  const result = await publishDuePosts(45_000).catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ ok: true, socialPosts: result }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
