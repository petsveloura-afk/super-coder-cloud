import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { openSecrets } from "./secrets";

export type Kind = "whatsapp" | "telegram" | "sms" | "whatsapp_qr" | "email" | "telegram_user" | "messenger" | "instagram";

export interface LoadedAccount {
  id: string;
  organization_id: string;
  kind: Kind;
  status: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  webhook_token: string;
}

/** Service-role read of one org's channel account, with decrypted secrets. */
export async function loadAccount(orgId: string, kind: Kind): Promise<LoadedAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_accounts")
    .select("id, organization_id, kind, status, config, secret_enc, webhook_token")
    .eq("organization_id", orgId)
    .eq("kind", kind)
    .maybeSingle();
  if (!data || data.status === "disabled") return null;
  return {
    id: data.id as string,
    organization_id: data.organization_id as string,
    kind: data.kind as Kind,
    status: data.status as string,
    config: (data.config as Record<string, string>) ?? {},
    secrets: openSecrets(data.secret_enc as string | null),
    webhook_token: data.webhook_token as string,
  };
}

export async function loadAccountByToken(kind: Kind, token: string): Promise<LoadedAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channel_accounts")
    .select("id, organization_id, kind, status, config, secret_enc, webhook_token")
    .eq("kind", kind)
    .eq("webhook_token", token)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    organization_id: data.organization_id as string,
    kind: data.kind as Kind,
    status: data.status as string,
    config: (data.config as Record<string, string>) ?? {},
    secrets: openSecrets(data.secret_enc as string | null),
    webhook_token: data.webhook_token as string,
  };
}

export async function markAccountError(id: string, error: string | null) {
  const admin = createAdminClient();
  await admin.from("channel_accounts").update({ status: error ? "error" : "active", last_error: error, updated_at: new Date().toISOString() }).eq("id", id);
}
