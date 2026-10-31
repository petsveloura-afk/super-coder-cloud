"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function loadDemoDataAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const l = fd.get("locale");
  const locale = isLocale(l) ? l : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage")) return { error: "errors.forbidden" };
  const supabase = await createClient();
  // The RPC re-checks permission and emptiness inside Postgres.
  const { data, error } = await supabase.rpc("load_demo_data", { org: ctx.org.id });
  if (error) return { error: error.code === "42501" ? "errors.forbidden" : "errors.generic" };
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, message: "dashboard.demoLoaded", messageParams: { count: Number(data ?? 0) } };
}

/** Wave 59 — the overview's live feed refreshes itself (what the agent did in the last minutes). */
export async function liveFeedAction(input: { locale: string }): Promise<ActionState<{ items: import("@/lib/dashboard/live-feed").FeedItem[] }>> {
  const locale = isLocale(input.locale) ? input.locale : "he";
  const ctx = await getOrgContext(locale);
  if (!ctx.can("inbox.read")) return { ok: true, data: { items: [] } };
  const supabase = await createClient();
  const { loadLiveFeed } = await import("@/lib/dashboard/live-feed");
  const items = await loadLiveFeed(supabase, ctx.org.id).catch(() => []);
  return { ok: true, data: { items } };
}
