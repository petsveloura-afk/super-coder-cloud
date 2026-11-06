import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CROSS_CHANNELS, convertedReason, followupPolicy, nightWaitMinutes } from "@/lib/ai/followup-playbook";
import { checkGuard } from "./guard";

/**
 * Follow-up playbook — the checks the scheduler adds around a planned follow-up / sequence step (the database guard
 * still decides first; these only ever hold back or move a message, they never allow one the guard refused):
 *   policy        the workspace policy + time zone, cached per run
 *   nightHold     no quiet hours set → follow-ups wait for the morning (21:30 – 08:30 business time)
 *   converted     the customer booked (upcoming appointment) or bought (deal won) → no more sales follow-ups
 *   crossChannel  (opt-in) WhatsApp window closed → another conversation the same customer opened, if the guard allows it there
 */
type Policy = ReturnType<typeof followupPolicy> & { tz: string | null };
const cache = new Map<string, { at: number; p: Policy }>();

/** forget the cached policies (tests; a new settings save is picked up within a minute anyway) */
export function resetFollowupPolicyCache(): void {
  cache.clear();
}

export async function orgFollowupPolicy(orgId: string): Promise<Policy> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const admin = createAdminClient();
  const [{ data: pol }, { data: org }] = await Promise.all([admin.rpc("conversation_policy", { p_org: orgId }), admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle()]);
  const p = { ...followupPolicy(pol as Record<string, unknown> | null), tz: ((org as { timezone?: string | null } | null)?.timezone as string | null) ?? null };
  cache.set(orgId, { at: Date.now(), p });
  return p;
}

/** minutes to wait (0 = send now) */
export function nightHold(p: Policy, now = new Date()): number {
  return nightWaitMinutes({ now, tz: p.tz, quietStart: p.quietStart, quietEnd: p.quietEnd, nightGuard: p.nightGuard });
}

/** moves a schedule that was just given back ("pending") to the morning instead of retrying every 5 minutes all night */
export async function postpone(scheduleId: string, minutes: number): Promise<void> {
  await createAdminClient()
    .from("conversation_schedules")
    .update({ run_at: new Date(Date.now() + Math.max(5, minutes) * 60_000).toISOString(), updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .eq("status", "pending");
}

export async function converted(orgId: string, contactId: string | null): Promise<"booked" | "bought" | null> {
  if (!contactId) return null;
  const admin = createAdminClient();
  const now = new Date();
  const [{ data: appts }, { data: deals }] = await Promise.all([
    admin.from("appointments").select("starts_at").eq("organization_id", orgId).eq("contact_id", contactId).in("status", ["scheduled", "confirmed"]).gte("starts_at", new Date(now.getTime() - 3_600_000).toISOString()).limit(3),
    admin.from("deals").select("closed_at").eq("organization_id", orgId).eq("contact_id", contactId).eq("status", "won").gte("closed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()).limit(3),
  ]);
  return convertedReason({ upcomingAppointments: ((appts ?? []) as { starts_at: string }[]).map((a) => a.starts_at), wonDeals: ((deals ?? []) as { closed_at: string | null }[]).map((d) => d.closed_at) }, now);
}

/**
 * Another conversation of the same customer where this follow-up may go instead (the customer opened it and wrote
 * there; every guard rule — consent, opt-out, caps, windows, quiet hours — must allow it). null = none.
 */
export async function crossChannelTarget(orgId: string, conversationId: string, contactId: string | null): Promise<{ id: string; channel: string; from: string } | null> {
  if (!contactId) return null;
  const admin = createAdminClient();
  const { data: self } = await admin.from("conversations").select("channel").eq("id", conversationId).maybeSingle();
  const { data: others } = await admin
    .from("conversations")
    .select("id, channel, last_message_at")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .neq("id", conversationId)
    .in("channel", CROSS_CHANNELS as unknown as string[])
    .order("last_message_at", { ascending: false })
    .limit(4);
  for (const o of (others ?? []) as { id: string; channel: string }[]) {
    // the customer must have written in that conversation himself
    const { data: inbound } = await admin.from("messages").select("id").eq("conversation_id", o.id).eq("direction", "in").limit(1);
    if (!inbound?.length) continue;
    const g = await checkGuard(o.id, "followup");
    if (g.allowed) return { id: o.id, channel: o.channel, from: String((self as { channel?: string } | null)?.channel ?? "") };
  }
  return null;
}
