import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // open until CRON_SECRET is configured (returns no data either way)
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/keepalive
 * Called daily by Vercel Cron and by the GitHub "Keep alive" workflow.
 * Runs one trivial database round-trip (public.ping()) so the Supabase
 * Free project registers activity and is not paused for inactivity.
 * Exposes no data. Requires `Authorization: Bearer <CRON_SECRET>` when set.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: false, reason: "supabase_not_configured" }, { status: 503 });

  const started = Date.now();
  const supabase = createSupabase(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("ping");
  const ok = !error && data === true;
  return NextResponse.json(
    { ok, db: ok ? "reachable" : "unreachable", ms: Date.now() - started, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
