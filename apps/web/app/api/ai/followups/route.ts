import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runFollowups } from "@/lib/ai/followups";
import { runPendingReplies } from "@/lib/ai/autopilot";
import { runStuckWatchdog } from "@/lib/ai/watchdog";

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
  // wave 15: nobody is left in silence — stuck chats are retried, then handed to the team
  const watchdog = await runStuckWatchdog(15_000).catch(() => ({ checked: 0, retried: 0, escalated: 0 }));
  // conversation guard: planned follow-ups / scheduled messages that are due (also run by /api/cron/growth)
  const schedules = await import("@/lib/conversations/scheduler").then((m) => m.runDueSchedules(15_000)).catch(() => null);
  // wave 10: bots connected before the Telegram Business update get the full update list
  // wave 15: Telegram Business connections are checked against Telegram itself — never silent when one is lost
  const bizHealth = await import("@/lib/channels/telegram-business-health").then((m) => m.checkTelegramBusinessHealth(10)).catch(() => ({ checked: 0, changed: 0 }));
  const healed = await import("@/lib/channels/telegram-setup").then((m) => m.healTelegramWebhooks(5)).catch(() => 0);
  return NextResponse.json({ ok: true, ...summary, pending, watchdog, bizHealth, healed, schedules }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
