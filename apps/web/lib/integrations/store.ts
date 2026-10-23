import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecrets, sealSecrets } from "@/lib/channels/secrets";

/**
 * Waves 15-18 — per-organization connections to outside services (invoicing,
 * conversion APIs, calendars…) in the `integrations` table, secrets in
 * `integration_credentials` (AES-256-GCM, never readable by users). Service role only.
 */
export interface LoadedIntegration {
  id: string;
  provider: string;
  status: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  last_success_at: string | null;
  last_error: string | null;
}

export async function loadIntegration(orgId: string, provider: string): Promise<LoadedIntegration | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("integrations").select("id, provider, status, config, last_success_at, last_error").eq("organization_id", orgId).eq("provider", provider).maybeSingle();
  if (!data) return null;
  const { data: cred } = await admin.from("integration_credentials").select("ciphertext").eq("integration_id", data.id).maybeSingle();
  let secrets: Record<string, string> = {};
  try {
    secrets = cred?.ciphertext ? openSecrets(cred.ciphertext as string) : {};
  } catch {
    secrets = {};
  }
  return {
    id: data.id as string,
    provider: data.provider as string,
    status: data.status as string,
    config: (data.config as Record<string, unknown>) ?? {},
    secrets,
    last_success_at: (data.last_success_at as string | null) ?? null,
    last_error: (data.last_error as string | null) ?? null,
  };
}

/** Creates / updates a connection. `secrets` undefined keeps the stored ones. */
export async function saveIntegration(orgId: string, provider: string, config: Record<string, unknown>, secrets?: Record<string, string>, status: "active" | "error" | "disabled" = "active"): Promise<string> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("integrations")
    .upsert({ organization_id: orgId, provider, config, status, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "organization_id,provider" })
    .select("id")
    .single();
  if (error || !row) throw new Error(`integration_save_failed:${error?.message ?? "unknown"}`);
  if (secrets) {
    const { error: e2 } = await admin.from("integration_credentials").upsert({ integration_id: row.id, organization_id: orgId, ciphertext: sealSecrets(secrets), rotated_at: new Date().toISOString() }, { onConflict: "integration_id" });
    if (e2) throw new Error(`integration_secret_failed:${e2.message}`);
  }
  return row.id as string;
}

export async function removeIntegration(orgId: string, provider: string): Promise<void> {
  await createAdminClient().from("integrations").delete().eq("organization_id", orgId).eq("provider", provider);
}

export async function markIntegration(id: string, ok: boolean, error?: string | null): Promise<void> {
  const patch = ok ? { last_success_at: new Date().toISOString(), last_error: null } : { last_error: (error ?? "error").slice(0, 500) };
  await createAdminClient().from("integrations").update(patch).eq("id", id);
}

/** Public view of the connections of one organization (no secrets). */
export async function listIntegrations(orgId: string, providers: string[]): Promise<Record<string, { status: string; config: Record<string, unknown>; last_success_at: string | null; last_error: string | null }>> {
  const { data } = await createAdminClient().from("integrations").select("provider, status, config, last_success_at, last_error").eq("organization_id", orgId).in("provider", providers);
  const out: Record<string, { status: string; config: Record<string, unknown>; last_success_at: string | null; last_error: string | null }> = {};
  for (const r of (data ?? []) as { provider: string; status: string; config: Record<string, unknown>; last_success_at: string | null; last_error: string | null }[]) out[r.provider] = r;
  return out;
}
