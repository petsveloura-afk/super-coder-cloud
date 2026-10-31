import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAILY_CALL_CAP, callbackCandidate, politeHour, reminderWindow, type CallPurpose } from "./outbound-core";

/**
 * Wave 59 — automatic outbound calls by the phone agent, run by the background cron:
 *   • reminder calls the day before an appointment (customers who booked — a service call);
 *   • follow-up calls to quiet leads — only contacts with marketing consent;
 * each turned on by the business on the phone screen, polite hours only, a daily cap, never twice for the
 * same appointment / lead. Never throws.
 */
async function alreadyCalled(orgId: string, purpose: CallPurpose, ref: string): Promise<boolean> {
  const { data } = await createAdminClient().from("voice_calls").select("id").eq("organization_id", orgId).eq("purpose", purpose).eq("purpose_ref", ref).limit(1).maybeSingle();
  return Boolean(data);
}

async function callsToday(orgId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await createAdminClient().from("voice_calls").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("direction", "out").not("purpose", "is", null).gte("created_at", start.toISOString());
  return count ?? 0;
}

/** Starts the agent's call and tags it with its purpose (the phone brain reads it on the first turn). */
async function placeCall(orgId: string, contactId: string, purpose: CallPurpose, ref: string): Promise<boolean> {
  const { startAgentCall } = await import("./agent");
  const before = new Date(Date.now() - 1000).toISOString();
  const r = await startAgentCall(orgId, contactId).catch(() => ({ ok: false }));
  if (!r.ok) return false;
  const admin = createAdminClient();
  const { data: row } = await admin.from("voice_calls").select("id").eq("organization_id", orgId).eq("contact_id", contactId).eq("direction", "out").gte("created_at", before).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (row) await admin.from("voice_calls").update({ purpose, purpose_ref: ref }).eq("id", row.id);
  return true;
}

export async function runOutboundCalls(budgetMs = 20_000): Promise<{ orgs: number; reminders: number; callbacks: number }> {
  const t0 = Date.now();
  const out = { orgs: 0, reminders: 0, callbacks: 0 };
  const admin = createAdminClient();
  const { data: settings, error } = await admin.from("phone_settings").select("organization_id, reminder_calls, callback_calls").or("reminder_calls.eq.true,callback_calls.eq.true").limit(50);
  if (error || !settings?.length) return out;
  const now = new Date();
  for (const s of settings as { organization_id: string; reminder_calls: boolean; callback_calls: boolean }[]) {
    if (Date.now() - t0 > budgetMs) break;
    const orgId = s.organization_id;
    const { data: org } = await admin.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
    if (!politeHour(now, (org?.timezone as string | undefined) || "Asia/Jerusalem")) continue;
    const { data: has } = await admin.rpc("has_feature", { p_org: orgId, p_feature: "voice_ai" });
    if (has !== true) continue;
    let left = DAILY_CALL_CAP - (await callsToday(orgId));
    if (left <= 0) continue;
    out.orgs++;
    if (s.reminder_calls) {
      const w = reminderWindow(now);
      const { data: appts } = await admin.from("appointments").select("id, contact_id").eq("organization_id", orgId).eq("status", "scheduled").not("contact_id", "is", null).gte("starts_at", w.from).lte("starts_at", w.to).order("starts_at").limit(10);
      for (const a of (appts ?? []) as { id: string; contact_id: string }[]) {
        if (left <= 0 || Date.now() - t0 > budgetMs) break;
        if (await alreadyCalled(orgId, "reminder", a.id)) continue;
        if (await placeCall(orgId, a.contact_id, "reminder", a.id)) {
          out.reminders++;
          left--;
        }
      }
    }
    if (s.callback_calls && left > 0) {
      const from = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const to = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      const { data: convs } = await admin.from("conversations").select("id, contact_id, lead_at, last_customer_at, sales_state").eq("organization_id", orgId).not("contact_id", "is", null).gte("lead_at", from).lte("lead_at", to).neq("channel", "voice").limit(20);
      const rows = (convs ?? []) as { id: string; contact_id: string; lead_at: string | null; last_customer_at: string | null; sales_state: string | null }[];
      const ids = [...new Set(rows.map((r) => r.contact_id))];
      const { data: people } = ids.length ? await admin.from("contacts").select("id, marketing_consent, opted_out_at, phone").in("id", ids).eq("organization_id", orgId) : { data: [] };
      const pmap = new Map(((people ?? []) as { id: string; marketing_consent: boolean; opted_out_at: string | null; phone: string | null }[]).map((p) => [p.id, p]));
      let placed = 0;
      for (const c of rows) {
        if (left <= 0 || placed >= 3 || Date.now() - t0 > budgetMs) break;
        const p = pmap.get(c.contact_id);
        if (!p?.phone) continue;
        if (!callbackCandidate({ leadAt: c.lead_at, lastCustomerAt: c.last_customer_at, salesState: c.sales_state, consent: p.marketing_consent, optedOut: Boolean(p.opted_out_at), now })) continue;
        if (await alreadyCalled(orgId, "callback", c.id)) continue;
        if (await placeCall(orgId, c.contact_id, "callback", c.id)) {
          out.callbacks++;
          placed++;
          left--;
        }
      }
    }
  }
  return out;
}
