"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/**
 * Instagram connected DIRECTLY (Instagram Login) — store and remove the account. It is stored exactly like the
 * Instagram account that comes with a Facebook Page (kind "instagram", config.ig_id, secret page_token), so the inbox,
 * the AI agent, comments, private replies and publishing need no other change. Marked config.mode = "instagram_login".
 */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export async function saveInstagramDirect(input: { locale: string; code: string; redirectUri: string }): Promise<ActionState<{ username: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!/^[A-Za-z0-9_\-.]{10,2000}$/.test(input.code)) return { error: "integrations.meta.cancelled" };
  const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const { igConnectFromCode, igSubscribe } = await import("@/lib/channels/ig-login");
  const r = await igConnectFromCode(input.code, input.redirectUri);
  if (!r.ok) return { error: "integrations.ig.failed", messageParams: { detail: r.error } };
  const { igAccountUsable } = await import("@/lib/channels/ig-login-core");
  if (!igAccountUsable(r.conn.profile.accountType)) return { error: "integrations.ig.personal" };
  const sub = await igSubscribe(r.conn.token);
  const p = r.conn.profile;
  const supabase = await createClient();
  const config: Record<string, string> = {
    ig_id: p.igId,
    username: p.username ?? "",
    mode: "instagram_login",
    token_expires: r.conn.expiresAt,
    ...(p.appScopedId ? { ig_app_id: p.appScopedId } : {}),
    ...(p.name ? { ig_name: p.name } : {}),
    ...(p.accountType ? { account_type: p.accountType } : {}),
  };
  const row = { config, secret_enc: sealSecrets({ page_token: r.conn.token }), status: "active", last_error: sub.ok ? null : `subscribe: ${sub.error ?? ""}`.slice(0, 500), name: (p.username ? `@${p.username}` : "Instagram").slice(0, 120), updated_at: new Date().toISOString() };
  const { data: existing } = await supabase.from("channel_accounts").select("id").eq("organization_id", ctx.org.id).eq("kind", "instagram").maybeSingle();
  const res = existing
    ? await supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", ctx.org.id)
    : await supabase.from("channel_accounts").insert({ ...row, organization_id: ctx.org.id, kind: "instagram", created_by: ctx.userId });
  if (res.error) return { error: dbErrorKey(res.error) };
  revalidatePath(`/${locale}/integrations`);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: "integrations.ig.connected", messageParams: { ig: p.username ?? "" }, data: { username: p.username ?? "" } };
}

/** removes ONLY the Instagram account (the Facebook Page stays connected) */
export async function disconnectInstagramAction(fd: FormData): Promise<ActionState> {
  const locale = loc(String(fd.get("locale") ?? "he"));
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data: acc } = await supabase.from("channel_accounts").select("id, config").eq("organization_id", ctx.org.id).eq("kind", "instagram").maybeSingle();
  if (acc && (acc.config as { mode?: string } | null)?.mode === "instagram_login") {
    const { loadAccountById } = await import("@/lib/social/accounts");
    const full = await loadAccountById(acc.id as string).catch(() => null);
    if (full?.secrets.page_token) {
      const { igUnsubscribe } = await import("@/lib/channels/ig-login");
      await igUnsubscribe(full.secrets.page_token).catch(() => undefined);
    }
  }
  const { error } = await supabase.from("channel_accounts").delete().eq("organization_id", ctx.org.id).eq("kind", "instagram");
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.channels.disconnected" };
}
