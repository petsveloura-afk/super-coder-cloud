import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { actLinksReady, actUrl } from "@/lib/act-links";
import { appointmentReminderText, REMINDER_CHANNELS, type ReminderWindow } from "./reminder-core";

/**
 * Wave 17 — appointment reminders to the customer 24 hours and 1 hour before, with
 * one-tap confirm / cancel links. Each one goes through the conversation guard
 * (kind "reminder"): a reminder never goes into a conversation a person is handling
 * right now, respects WhatsApp's 24-hour window, caps and quiet hours — and when the
 * customer's chat channel is not allowed it falls back to e-mail.
 * Claimed atomically (claim_appointment_reminders) so it is sent once.
 */
interface Due {
  appointment_id: string;
  organization_id: string;
  contact_id: string;
  title: string | null;
  starts_at: string;
  location: string | null;
  window_kind: ReminderWindow;
}

export async function runAppointmentReminders(budgetMs = 15_000): Promise<{ claimed: number; sent: number; skipped: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { claimed: 0, sent: 0, skipped: 0 };
  const started = Date.now();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_appointment_reminders", { p_limit: 50 });
  if (error) {
    if (error.code !== "PGRST202") console.error("claim_appointment_reminders failed", error.message);
    return { claimed: 0, sent: 0, skipped: 0 };
  }
  const rows = (data ?? []) as Due[];
  const orgs = new Map<string, { locale: "he" | "ar" | "en"; tz: string; name: string }>();
  let sent = 0;
  let skipped = 0;
  for (const d of rows) {
    if (Date.now() - started > budgetMs) break;
    let org = orgs.get(d.organization_id);
    if (!org) {
      const { data: o } = await admin.from("organizations").select("locale, timezone, name").eq("id", d.organization_id).maybeSingle();
      org = { locale: (o?.locale === "en" || o?.locale === "ar" ? o.locale : "he") as "he" | "ar" | "en", tz: (o?.timezone as string) || "Asia/Jerusalem", name: (o?.name as string) ?? "" };
      orgs.set(d.organization_id, org);
    }
    const ok = await remindOne(d, org).catch((e) => {
      console.error("appointment reminder failed", (e as Error).message);
      return false;
    });
    if (ok) sent++;
    else skipped++;
  }
  return { claimed: rows.length, sent, skipped };
}

async function remindOne(d: Due, org: { locale: "he" | "ar" | "en"; tz: string; name: string }): Promise<boolean> {
  const admin = createAdminClient();
  const exp = Math.floor(new Date(d.starts_at).getTime() / 1000);
  const links = actLinksReady()
    ? {
        confirm: actUrl(publicEnv.appUrl, org.locale, { k: "appt", id: d.appointment_id, a: "confirm", o: d.organization_id, e: exp }),
        cancel: actUrl(publicEnv.appUrl, org.locale, { k: "appt", id: d.appointment_id, a: "cancel", o: d.organization_id, e: exp }),
      }
    : undefined;
  const text = appointmentReminderText(org.locale, d.window_kind, { title: d.title, starts_at: d.starts_at, location: d.location, org: org.name }, org.tz, links);

  // 1) the customer's own chat (most recent first), only when the guard allows a reminder now
  const { data: convs } = await admin
    .from("conversations")
    .select("id, channel")
    .eq("organization_id", d.organization_id)
    .eq("contact_id", d.contact_id)
    .in("channel", [...REMINDER_CHANNELS])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(4);
  const { checkGuard } = await import("@/lib/conversations/guard");
  for (const c of (convs ?? []) as { id: string; channel: string }[]) {
    const g = await checkGuard(c.id, "reminder");
    if (!g.allowed) continue;
    const { sendToConversation } = await import("@/lib/channels/send-message");
    const r = await sendToConversation(d.organization_id, c.id, text, undefined, { meta: { system: "reminder", appointment_id: d.appointment_id, window: d.window_kind } });
    if (r.ok) return true;
  }

  // 2) no chat yet: a new WhatsApp / SMS conversation via the contact's phone (guard checked on the contact)
  const { checkContact } = await import("@/lib/conversations/guard");
  const cg = await checkContact(d.contact_id, "reminder");
  if (!convs?.length && cg.allowed) {
    const { sendToContact } = await import("@/lib/channels/send-message");
    for (const kind of ["whatsapp", "sms"] as const) {
      const r = await sendToContact(kind, d.organization_id, d.contact_id, text).catch(() => ({ ok: false }));
      if (r.ok) return true;
    }
  }

  // 3) e-mail fallback (transactional — the customer booked this meeting)
  if (!cg.allowed && cg.reason !== "opted_out") return false;
  const { data: c } = await admin.from("contacts").select("email").eq("id", d.contact_id).eq("organization_id", d.organization_id).maybeSingle();
  const to = (c?.email as string | null) ?? null;
  const { emailConfigured, escapeHtml, sendEmail } = await import("@/lib/email/send");
  if (!to || !emailConfigured()) return false;
  const html = `<div dir="${org.locale === "en" ? "ltr" : "rtl"}" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7">${escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>")}</div>`;
  const subject = text.split("\n")[0]!.slice(0, 200);
  const res = await sendEmail({ to, subject, html, text });
  return res.sent;
}
