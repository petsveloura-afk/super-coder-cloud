"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/**
 * Wave 19 — one-click connections (Facebook Page + Instagram with one Meta login).
 * The popup gives a code; the Pages (and their tokens) never reach the browser: when the
 * business manages several Pages, the list comes back sealed (AES-GCM, 10 minutes) and the
 * chosen Page is opened on the server.
 */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export interface MetaPageChoice {
  id: string;
  name: string;
  instagram: string | null;
}

export async function connectMetaPagesAction(input: { locale: string; code: string }): Promise<ActionState<{ choose?: MetaPageChoice[]; sealed?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!z.string().trim().min(10).max(2000).safeParse(input.code).success) return { error: "integrations.meta.cancelled" };
  const { encryptionReady, sealSecrets } = await import("@/lib/channels/secrets");
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const { pagesFromLoginCode } = await import("@/lib/channels/meta-pages");
  const r = await pagesFromLoginCode(input.code.trim());
  if (!r.ok) return { error: "integrations.meta.failed", messageParams: { detail: r.error ?? "" } };
  if (!r.pages.length) return { error: "integrations.meta.noPages" };
  if (r.pages.length === 1) return savePage<{ choose?: MetaPageChoice[]; sealed?: string }>(locale, ctx.org.id, ctx.userId, r.pages[0]!);
  const sealed = sealSecrets({ pages: JSON.stringify(r.pages), at: String(Date.now()), org: ctx.org.id });
  return { ok: true, data: { choose: r.pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram?.username ?? (p.instagram ? "Instagram" : null) })), sealed } };
}

export async function chooseMetaPageAction(input: { locale: string; sealed: string; pageId: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  if (!/^\d{3,40}$/.test(input.pageId)) return { error: "validation.invalidId" };
  const { openSecrets } = await import("@/lib/channels/secrets");
  let pages: { id: string; name: string; token: string; instagram: { id: string; username: string | null } | null }[] = [];
  try {
    const box = openSecrets(input.sealed);
    if (box.org !== ctx.org.id || Date.now() - Number(box.at) > 10 * 60_000) return { error: "integrations.meta.expired" };
    pages = JSON.parse(box.pages ?? "[]");
  } catch {
    return { error: "integrations.meta.expired" };
  }
  const page = pages.find((p) => p.id === input.pageId);
  if (!page) return { error: "validation.invalidId" };
  return savePage(locale, ctx.org.id, ctx.userId, page);
}

async function savePage<T = undefined>(locale: string, orgId: string, userId: string, page: { id: string; name: string; token: string; instagram: { id: string; username: string | null } | null }): Promise<ActionState<T>> {
  const { sealSecrets } = await import("@/lib/channels/secrets");
  const { subscribePage } = await import("@/lib/channels/meta-pages");
  const sub = await subscribePage(page.id, page.token);
  const supabase = await createClient();
  const upsert = async (kind: "messenger" | "instagram", config: Record<string, string>, name: string) => {
    const row = { config, secret_enc: sealSecrets({ page_token: page.token }), status: "active", last_error: sub.ok ? null : `subscribe: ${sub.error ?? ""}`.slice(0, 500), name: name.slice(0, 120), updated_at: new Date().toISOString() };
    const { data: existing } = await supabase.from("channel_accounts").select("id").eq("organization_id", orgId).eq("kind", kind).maybeSingle();
    return existing
      ? supabase.from("channel_accounts").update(row).eq("id", existing.id).eq("organization_id", orgId)
      : supabase.from("channel_accounts").insert({ ...row, organization_id: orgId, kind, created_by: userId });
  };
  const m = await upsert("messenger", { page_id: page.id, page_name: page.name, mode: "business_login" }, page.name || "Messenger");
  if (m.error) return { error: dbErrorKey(m.error) };
  if (page.instagram) {
    const ig = await upsert("instagram", { ig_id: page.instagram.id, username: page.instagram.username ?? "", page_id: page.id, mode: "business_login" }, page.instagram.username ? `@${page.instagram.username}` : "Instagram");
    if (ig.error) return { error: dbErrorKey(ig.error) };
  }
  revalidatePath(`/${locale}/integrations`);
  revalidatePath(`/${locale}/inbox`);
  return { ok: true, message: page.instagram ? "integrations.meta.connectedBoth" : "integrations.meta.connectedPage", messageParams: { page: page.name, ig: page.instagram?.username ?? "" } };
}

export async function disconnectMetaPagesAction(fd: FormData): Promise<ActionState> {
  const locale = loc(String(fd.get("locale") ?? "he"));
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  const { data: acc } = await supabase.from("channel_accounts").select("id, config").eq("organization_id", ctx.org.id).eq("kind", "messenger").maybeSingle();
  if (acc) {
    const { loadAccountById } = await import("@/lib/social/accounts");
    const full = await loadAccountById(acc.id as string);
    if (full?.secrets.page_token && full.config.page_id) {
      const { unsubscribePage } = await import("@/lib/channels/meta-pages");
      await unsubscribePage(full.config.page_id, full.secrets.page_token).catch(() => undefined);
    }
  }
  const { error } = await supabase.from("channel_accounts").delete().eq("organization_id", ctx.org.id).in("kind", ["messenger", "instagram"]);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "integrations.channels.disconnected" };
}
