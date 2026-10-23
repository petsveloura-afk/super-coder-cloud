"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";

/**
 * Wave 15 — each member's own channels (task reminders, meetings, urgent calls),
 * availability for lead routing, and the workspace's lead routing rules.
 */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";
export type MyEvent = "tasks" | "appointments" | "escalation" | "leads" | "handoff";
const MY_EVENTS = ["tasks", "appointments", "escalation", "leads", "handoff"] as const;

const myChannelSchema = z.object({
  kind: z.enum(["email", "telegram", "whatsapp", "sms", "call"]),
  target: z.string().trim().max(200).optional().default(""),
  events: z.array(z.enum(MY_EVENTS)).min(1),
});

export async function addMyChannelAction(input: { locale: string; kind: string; target?: string; events: string[] }): Promise<ActionState<{ invite?: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const p = myChannelSchema.safeParse(input);
  if (!p.success) return { error: "notify.invalid" };
  const { normalizeTarget, newInviteCode } = await import("@/lib/notify/format");
  const supabase = await createClient();
  let target: string | null = null;
  let invite: string | null = null;
  if (p.data.kind === "telegram") {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data: bot } = await createAdminClient().from("channel_accounts").select("id").eq("organization_id", ctx.org.id).eq("kind", "telegram").maybeSingle();
    if (!bot) return { error: "myChannels.needBot" };
    invite = newInviteCode();
  } else {
    // wave 16: "call" = urgent phone calls (same phone rules as SMS)
    target = normalizeTarget(p.data.kind === "call" ? "sms" : p.data.kind, p.data.target);
    if (!target) return { error: p.data.kind === "email" ? "notify.badEmail" : "notify.badPhone" };
  }
  const { error } = await supabase.from("notify_recipients").insert({
    organization_id: ctx.org.id,
    user_id: ctx.userId,
    kind: p.data.kind,
    target,
    label: ctx.profile?.full_name?.slice(0, 80) || null,
    events: p.data.events,
    invite_code: invite,
    verified_at: target ? new Date().toISOString() : null,
    created_by: ctx.userId,
  });
  if (error) return { error: error.message.includes("plan_limit:notify_recipients") ? "myChannels.tooMany" : dbErrorKey(error) };
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: "myChannels.added", data: invite ? { invite } : {} };
}

export async function updateMyChannelAction(input: { locale: string; id: string; enabled?: boolean; events?: string[] }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const patch: Record<string, unknown> = {};
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (input.events) {
    const ev = z.array(z.enum(MY_EVENTS)).min(1).safeParse(input.events);
    if (!ev.success) return { error: "notify.invalid" };
    patch.events = ev.data;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("notify_recipients").update(patch).eq("id", input.id).eq("organization_id", ctx.org.id).eq("user_id", ctx.userId).select("id");
  if (error) return { error: dbErrorKey(error) };
  if (!data?.length) return { error: "errors.notFound" };
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

export async function deleteMyChannelAction(input: { locale: string; id: string }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalidId" };
  const supabase = await createClient();
  const { error } = await supabase.from("notify_recipients").delete().eq("id", input.id).eq("organization_id", ctx.org.id).eq("user_id", ctx.userId);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

/** "I'm available for new leads" — used by round robin / least loaded routing. */
export async function setMyAvailabilityAction(input: { locale: string; available: boolean }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  // a member may only change HIS OWN availability (organization_members updates need members.manage)
  const { error } = await createAdminClient().from("organization_members").update({ available: Boolean(input.available) }).eq("organization_id", ctx.org.id).eq("user_id", ctx.userId);
  if (error) return { error: "errors.generic" };
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: input.available ? "routing.nowAvailable" : "routing.nowAway" };
}

const routingSchema = z.object({
  mode: z.enum(["off", "round_robin", "least_loaded"]),
  members: z.array(z.uuid()).max(200),
  contacts: z.boolean(),
  conversations: z.boolean(),
});

export async function saveLeadRoutingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd.get("locale"));
  const ctx = await getOrgContext(locale);
  if (!ctx.can("settings.manage") && !ctx.can("members.manage")) return { error: "errors.forbidden" };
  const parsed = routingSchema.safeParse({
    mode: fd.get("mode"),
    members: fd.getAll("members").map(String),
    contacts: fd.get("contacts") === "on",
    conversations: fd.get("conversations") === "on",
  });
  if (!parsed.success) return { error: "routing.invalid" };
  if (parsed.data.mode !== "off") {
    const { orgHasFeature } = await import("@/lib/billing/features");
    if (!(await orgHasFeature(ctx.org.id, "lead_routing"))) return { error: "plans.locked.lead_routing.title" };
  }
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  // only real members of this workspace
  const { data: real } = await admin.from("organization_members").select("user_id").eq("organization_id", ctx.org.id).in("user_id", parsed.data.members.length ? parsed.data.members : ["00000000-0000-0000-0000-000000000000"]);
  const members = ((real ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const { error } = await admin.from("organizations").update({ lead_routing: { ...parsed.data, members } }).eq("id", ctx.org.id);
  if (error) return { error: "errors.generic" };
  await admin.from("audit_logs").insert({ organization_id: ctx.org.id, actor_id: ctx.userId, action: "routing.updated", entity_type: "organization", entity_id: ctx.org.id, metadata: { mode: parsed.data.mode, members: members.length } });
  revalidatePath(`/${locale}/settings`);
  return { ok: true, message: "routing.saved" };
}
