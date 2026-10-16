import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/** Anonymous (no session) server client for public pages — only anon-granted RPCs work. */
export function createAnonClient() {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
