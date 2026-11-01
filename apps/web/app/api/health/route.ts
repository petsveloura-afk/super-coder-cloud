import { NextResponse } from "next/server";
import { integrationAvailability } from "@scc/shared/env";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + configuration summary. Reports only booleans — never values.
 */
export async function GET() {
  // spec A3: live checks (database, storage, job queue lag) — still booleans / numbers only, never values
  const live = await liveChecks().catch(() => null);
  return NextResponse.json(
    {
      ...(live ? { checks: live } : {}),
      status: "ok",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
      supabaseConfigured: isSupabaseConfigured(),
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      encryptionKeyConfigured: /^[A-Fa-f0-9]{64}$/.test(process.env.ENCRYPTION_KEY ?? ""),
      region: process.env.VERCEL_REGION ?? null,
      integrations: integrationAvailability(process.env),
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function liveChecks(): Promise<Record<string, unknown> | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !isSupabaseConfigured()) return null;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const t0 = Date.now();
  const db = await admin.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
  const dbMs = Date.now() - t0;
  const storage = await admin.storage.listBuckets().then((r) => !r.error).catch(() => false);
  const { data: oldest } = await admin.from("jobs").select("run_after").eq("status", "queued").lte("run_after", new Date().toISOString()).order("run_after").limit(1).maybeSingle();
  const queueLagSec = oldest?.run_after ? Math.max(0, Math.round((Date.now() - new Date(oldest.run_after as string).getTime()) / 1000)) : 0;
  return { database: !db.error, databaseMs: dbMs, storage, queueLagSec };
}
