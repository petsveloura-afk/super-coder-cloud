"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";

/**
 * Round 12 — platform admin: remove payers from the payments list.
 *   • void   (recommended) — the payment stays in the books with status "voided" and a reason; it no longer counts as
 *            revenue and is hidden from the list. A receipt that was issued keeps existing (tax records).
 *   • delete — the record is removed for good (for test payments). A full copy is written to the audit log first, and the
 *            receipt number is never reused. A paid credit pack keeps its credits — refund it at PayPal to take them back.
 * Platform admins only; every call is re-checked on the server.
 */
const loc = (l: string): "he" | "en" | "ar" => (l === "ar" || l === "en" ? l : "he");
const ids = z.array(z.string().uuid()).min(1).max(100);

async function gate(locale: string) {
  const ctx = await getOrgContext(loc(locale));
  if (!ctx.isPlatformAdmin) return { error: "errors.forbidden" as const };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "common.error" as const };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return { ctx, a: createAdminClient() };
}

type Admin = ReturnType<(typeof import("@/lib/supabase/admin"))["createAdminClient"]>;

async function log(a: Admin, rows: Record<string, unknown>[], action: string, actor: string) {
  const entries = rows.map((r) => ({ organization_id: r.organization_id, actor_id: actor, action, entity_type: "billing_payment", entity_id: r.id, metadata: { snapshot: r } }));
  if (entries.length)
    await a
      .from("audit_logs")
      .insert(entries)
      .then(
        () => undefined,
        () => undefined,
      );
}

export async function voidPaymentsAction(input: { locale: string; ids: string[]; reason?: string }): Promise<ActionState<{ n: number }>> {
  const g = await gate(input.locale);
  if ("error" in g) return { error: g.error };
  if (!g.ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  const p = ids.safeParse([...new Set(input.ids ?? [])]);
  if (!p.success) return { error: "validation.invalidId" };
  const reason = String(input.reason ?? "").trim().slice(0, 300) || "voided by the platform admin";
  const { data: rows } = await g.a.from("billing_payments").select("*").in("id", p.data).neq("status", "voided");
  const list = (rows ?? []) as Record<string, unknown>[];
  if (!list.length) return { error: "errors.notFound" };
  const { error } = await g.a.from("billing_payments").update({ status: "voided", voided_at: new Date().toISOString(), void_reason: reason }).in("id", list.map((r) => r.id as string));
  if (error) return { error: "common.error" };
  await log(g.a, list, "billing.payment_voided", g.ctx.userId);
  revalidatePath(`/${loc(input.locale)}/admin`);
  return { ok: true, message: "admin.payments.voided", messageParams: { n: list.length }, data: { n: list.length } };
}

export async function deletePaymentsAction(input: { locale: string; ids: string[]; confirm: string }): Promise<ActionState<{ n: number }>> {
  const g = await gate(input.locale);
  if ("error" in g) return { error: g.error };
  if (!g.ctx.isPlatformAdmin) return { error: "errors.forbidden" };
  if (String(input.confirm ?? "").trim().toUpperCase() !== "DELETE") return { error: "admin.payments.typeDelete" };
  const p = ids.safeParse([...new Set(input.ids ?? [])]);
  if (!p.success) return { error: "validation.invalidId" };
  const { data: rows } = await g.a.from("billing_payments").select("*").in("id", p.data);
  const list = (rows ?? []) as Record<string, unknown>[];
  if (!list.length) return { error: "errors.notFound" };
  // the copy first — if it cannot be written, nothing is deleted
  const entries = list.map((r) => ({ organization_id: r.organization_id, actor_id: g.ctx.userId, action: "billing.payment_deleted", entity_type: "billing_payment", entity_id: r.id, metadata: { snapshot: r } }));
  const { error: logErr } = await g.a.from("audit_logs").insert(entries);
  if (logErr) return { error: "admin.payments.auditFailed" };
  const { error } = await g.a.from("billing_payments").delete().in("id", list.map((r) => r.id as string));
  if (error) return { error: "common.error" };
  revalidatePath(`/${loc(input.locale)}/admin`);
  return { ok: true, message: "admin.payments.deleted", messageParams: { n: list.length }, data: { n: list.length } };
}
