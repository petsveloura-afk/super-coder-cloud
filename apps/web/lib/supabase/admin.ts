import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client — BYPASSES RLS. Server-only. Use exclusively for
 * platform tasks that cannot run as the user (webhooks, background jobs,
 * reading encrypted integration credentials) and ALWAYS scope queries by an
 * organization_id that was authorized beforehand.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
