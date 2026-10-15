import { NextResponse } from "next/server";
import { integrationAvailability } from "@scc/shared/env";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + configuration summary. Reports only booleans — never values.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      supabaseConfigured: isSupabaseConfigured(),
      integrations: integrationAvailability(process.env),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
