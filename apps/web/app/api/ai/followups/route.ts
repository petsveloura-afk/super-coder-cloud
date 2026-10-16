import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runFollowups } from "@/lib/ai/followups";
import { runPendingReplies } from "@/lib/ai/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET|POST /api/ai/followups — the AI agent follows up with customers who went quiet. Bearer CRON_SECRET. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  // first the safety net (unanswered customer messages), then follow-ups
  const pending = await runPendingReplies(25_000);
  const summary = await runFollowups(25_000);
  // wave 10: bots connected before the Telegram Business update get the full update list
  const healed = await import("@/lib/channels/telegram-setup").then((m) => m.healTelegramWebhooks(5)).catch(() => 0);
  return NextResponse.json({ ok: true, ...summary, pending, healed }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
