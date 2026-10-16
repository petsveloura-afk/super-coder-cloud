import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pollAllMailboxes } from "@/lib/channels/email";

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
 * GET|POST /api/channels/email/poll — reads new e-mails of every connected
 * mailbox into the inbox (the AI agent answers them when enabled).
 * Called by the GitHub "jobs" workflow (every 5 minutes) and, when the
 * WhatsApp bridge service is deployed, every minute. Requires Bearer CRON_SECRET.
 */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 503 });
  const summary = await pollAllMailboxes(40_000);
  return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
