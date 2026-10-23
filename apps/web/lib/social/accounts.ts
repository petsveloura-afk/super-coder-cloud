import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecrets } from "@/lib/channels/secrets";

/** Channel account by id (with decrypted secrets) — webhooks already know the account row. */
export async function loadAccountById(id: string): Promise<{ id: string; organization_id: string; kind: string; config: Record<string, string>; secrets: Record<string, string> } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("channel_accounts").select("id, organization_id, kind, config, secret_enc").eq("id", id).maybeSingle();
  if (!data) return null;
  let secrets: Record<string, string> = {};
  try {
    secrets = openSecrets(data.secret_enc as string | null);
  } catch {
    secrets = {};
  }
  return { id: data.id as string, organization_id: data.organization_id as string, kind: data.kind as string, config: (data.config as Record<string, string>) ?? {}, secrets };
}
