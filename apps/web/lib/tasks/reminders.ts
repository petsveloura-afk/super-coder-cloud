import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { actLinksReady, actUrl } from "@/lib/act-links";

/**
 * Wave 15 — task reminders to the team member the task is assigned to, on HIS
 * personal channels (notify_recipients with user_id + event "tasks"): Telegram with
 * "✅ done" / "⏰ +15 min" buttons, WhatsApp / SMS / e-mail with one-tap links.
 * Always also an in-app notification. Claimed atomically (claim_task_reminders).
 */
interface Due {
  task_id: string;
  organization_id: string;
  assignee_id: string;
  title: string;
  due_at: string | null;
  contact_id: string | null;
  contact_name: string | null;
  snooze_count: number;
}

const L = {
  he: { head: "⏰ תזכורת למשימה", due: "מועד", contact: "לקוח", done: "✅ בוצע", snooze: "⏰ עוד 15 דק׳", open: "פתיחה במערכת", doneLink: "סימון כבוצע", snoozeLink: "דחייה ב-15 דקות" },
  ar: { head: "⏰ تذكير بمهمة", due: "الموعد", contact: "العميل", done: "✅ تم", snooze: "⏰ بعد 15 د", open: "فتح في النظام", doneLink: "تحديد كمنجز", snoozeLink: "تأجيل 15 دقيقة" },
  en: { head: "⏰ Task reminder", due: "Due", contact: "Customer", done: "✅ Done", snooze: "⏰ +15 min", open: "Open in the app", doneLink: "Mark done", snoozeLink: "Snooze 15 minutes" },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function reminderText(locale: "he" | "ar" | "en", d: Pick<Due, "title" | "due_at" | "contact_name">, tz: string, links?: { done?: string; snooze?: string; open: string }): string {
  const l = L[locale];
  const due = d.due_at ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { dateStyle: "short", timeStyle: "short", timeZone: tz }).format(new Date(d.due_at)) : null;
  return [
    `${l.head}: ${d.title}`,
    due ? `${l.due}: ${due}` : "",
    d.contact_name ? `${l.contact}: ${d.contact_name}` : "",
    links?.done ? `${l.doneLink}: ${links.done}` : "",
    links?.snooze ? `${l.snoozeLink}: ${links.snooze}` : "",
    links ? `${l.open}: ${links.open}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runTaskReminders(budgetMs = 20_000): Promise<{ claimed: number; sent: number }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { claimed: 0, sent: 0 };
  const started = Date.now();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_task_reminders", { p_limit: 50 });
  if (error) {
    console.error("claim_task_reminders failed", error.message);
    return { claimed: 0, sent: 0 };
  }
  const rows = (data ?? []) as Due[];
  let sent = 0;
  const app = publicEnv.appUrl.replace(/\/$/, "");
  const orgCache = new Map<string, { locale: "he" | "ar" | "en"; tz: string; name: string }>();
  for (const d of rows) {
    if (Date.now() - started > budgetMs) break;
    let org = orgCache.get(d.organization_id);
    if (!org) {
      const { data: o } = await admin.from("organizations").select("locale, timezone, name").eq("id", d.organization_id).maybeSingle();
      org = { locale: (o?.locale === "en" || o?.locale === "ar" ? o.locale : "he") as "he" | "ar" | "en", tz: (o?.timezone as string) || "Asia/Jerusalem", name: (o?.name as string) ?? "" };
      orgCache.set(d.organization_id, org);
    }
    const open = `${app}/${org.locale}/tasks`;
    // in-app notification (bell) — always
    await admin.from("notifications").insert({ organization_id: d.organization_id, user_id: d.assignee_id, kind: "task", title_key: "tasks.reminderNotification", params: { title: d.title }, link: "/tasks" });
    const { data: recs } = await admin
      .from("notify_recipients")
      .select("id, kind, target")
      .eq("organization_id", d.organization_id)
      .eq("user_id", d.assignee_id)
      .eq("enabled", true)
      .not("target", "is", null)
      .contains("events", ["tasks"])
      .limit(6);
    for (const r of (recs ?? []) as { id: string; kind: string; target: string }[]) {
      const ok = await sendReminder(d, org, r, open).catch((e) => {
        console.error("task reminder failed", (e as Error).message);
        return false;
      });
      if (ok) sent++;
      await admin.from("notify_recipients").update(ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: "reminder_failed" }).eq("id", r.id);
    }
  }
  return { claimed: rows.length, sent };
}

async function sendReminder(d: Due, org: { locale: "he" | "ar" | "en"; tz: string }, r: { kind: string; target: string }, open: string): Promise<boolean> {
  const l = L[org.locale];
  const { loadAccount } = await import("@/lib/channels/accounts");
  if (r.kind === "telegram") {
    const acc = await loadAccount(d.organization_id, "telegram");
    if (!acc?.secrets.bot_token) return false;
    const { telegramCall } = await import("@/lib/channels/providers");
    const details = reminderText(org.locale, d, org.tz).split("\n").slice(1).join("\n");
    const text = [`<b>${esc(l.head)}</b>`, `<b>${esc(d.title)}</b>`, details ? esc(details) : ""].filter(Boolean).join("\n");
    const res = await telegramCall(acc.secrets.bot_token, "sendMessage", {
      chat_id: r.target,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: l.done, callback_data: `tk:d:${d.task_id}` },
            { text: l.snooze, callback_data: `tk:s:${d.task_id}` },
          ],
          ...(/^https:\/\//.test(open) ? [[{ text: l.open, url: open }]] : []),
        ],
      },
    });
    return res.ok;
  }
  const links = actLinksReady()
    ? {
        done: actUrl(publicEnv.appUrl, org.locale, { k: "task", id: d.task_id, a: "done", o: d.organization_id, u: d.assignee_id, e: Math.floor(Date.now() / 1000) + 7 * 86400 }),
        snooze: actUrl(publicEnv.appUrl, org.locale, { k: "task", id: d.task_id, a: "snooze", o: d.organization_id, u: d.assignee_id, e: Math.floor(Date.now() / 1000) + 2 * 86400 }),
        open,
      }
    : { open };
  const text = reminderText(org.locale, d, org.tz, links);
  if (r.kind === "email") {
    const { sendEmail, escapeHtml } = await import("@/lib/email/send");
    const html = `<div dir="${org.locale === "en" ? "ltr" : "rtl"}" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7">${escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</div>`;
    const res = await sendEmail({ to: r.target, subject: `${l.head}: ${d.title}`.slice(0, 200), html, text });
    return res.sent;
  }
  if (r.kind === "whatsapp") {
    const qr = await loadAccount(d.organization_id, "whatsapp_qr");
    if (qr) {
      const { bridgeSend } = await import("@/lib/channels/wa-bridge");
      const res = await bridgeSend(qr, r.target, text);
      if (res.ok) return true;
    }
    const wa = await loadAccount(d.organization_id, "whatsapp");
    if (!wa) return false;
    const { whatsappSendText } = await import("@/lib/channels/providers");
    return (await whatsappSendText(wa.secrets.access_token ?? "", wa.config.phone_number_id ?? "", r.target, text)).ok;
  }
  if (r.kind === "sms") {
    const sms = await loadAccount(d.organization_id, "sms");
    if (!sms) return false;
    const { twilioSendSms } = await import("@/lib/channels/providers");
    return (await twilioSendSms(sms.config.account_sid ?? "", sms.secrets.auth_token ?? "", sms.config.from_number ?? "", r.target, text.slice(0, 1500))).ok;
  }
  return false;
}

/**
 * Telegram inline buttons from a reminder: "tk:d:<task>" (done) / "tk:s:<task>" (snooze).
 * Only the member the reminder belongs to (his linked chat) can act on his own task.
 */
export async function handleTaskCallback(token: string, cq: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number }; message_id: number } }): Promise<boolean> {
  const m = /^tk:([ds]):([0-9a-f-]{36})$/.exec(cq.data ?? "");
  if (!m) return false;
  const { loadAccountByToken } = await import("@/lib/channels/accounts");
  const acc = await loadAccountByToken("telegram", token);
  if (!acc?.secrets.bot_token) return true;
  const { telegramCall } = await import("@/lib/channels/providers");
  const admin = createAdminClient();
  const { data: rec } = await admin
    .from("notify_recipients")
    .select("user_id")
    .eq("organization_id", acc.organization_id)
    .eq("kind", "telegram")
    .eq("target", String(cq.from.id))
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: o } = await admin.from("organizations").select("locale").eq("id", acc.organization_id).maybeSingle();
  const locale = (o?.locale === "en" || o?.locale === "ar" ? o.locale : "he") as "he" | "ar" | "en";
  const msg = {
    he: { done: "✅ סומן כבוצע", snooze: "⏰ אזכיר שוב בעוד 15 דקות", denied: "אין הרשאה למשימה הזו", gone: "המשימה כבר סגורה" },
    ar: { done: "✅ تم الإنجاز", snooze: "⏰ سأذكّرك بعد 15 دقيقة", denied: "لا صلاحية لهذه المهمة", gone: "المهمة مغلقة" },
    en: { done: "✅ Marked done", snooze: "⏰ I'll remind you again in 15 minutes", denied: "Not allowed for this task", gone: "The task is already closed" },
  }[locale];
  if (!rec?.user_id) {
    await telegramCall(acc.secrets.bot_token, "answerCallbackQuery", { callback_query_id: cq.id, text: msg.denied, show_alert: true });
    return true;
  }
  const action = m[1] === "d" ? "done" : "snooze";
  const { data } = await admin.rpc("task_reminder_action", { p_task: m[2], p_user: rec.user_id, p_action: action, p_minutes: 15 });
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  const text = r.ok ? (action === "done" ? msg.done : msg.snooze) : r.error === "closed" ? msg.gone : msg.denied;
  await telegramCall(acc.secrets.bot_token, "answerCallbackQuery", { callback_query_id: cq.id, text });
  if (r.ok && cq.message) {
    await telegramCall(acc.secrets.bot_token, "editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[{ text, callback_data: "tk:noop" }]] } });
  }
  return true;
}
