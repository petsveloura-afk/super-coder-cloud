/**
 * Team updates — pure helpers (unit-tested): message texts for e-mail /
 * Telegram / WhatsApp / SMS, invite codes and Telegram /start payloads.
 */

export type NotifyEvent = "messages" | "leads" | "handoff" | "daily";
export const NOTIFY_EVENTS: NotifyEvent[] = ["messages", "leads", "handoff"];
export type NotifyKind = "email" | "telegram" | "whatsapp" | "sms";

export interface NotifyPayload {
  orgName: string;
  /** customer name / title of the conversation */
  customer?: string | null;
  channel?: string | null;
  /** last customer message */
  customerText?: string | null;
  /** what the agent answered */
  agentText?: string | null;
  agentName?: string | null;
  lead?: { name?: string; phone?: string; email?: string; need?: string; budget?: string; score?: string; summary?: string } | null;
  reason?: string | null;
  link?: string | null;
}

const CH: Record<string, string> = {
  telegram: "Telegram",
  telegram_user: "Telegram",
  whatsapp: "WhatsApp",
  whatsapp_qr: "WhatsApp",
  web: "צ׳אט באתר",
  email: "מייל",
  sms: "SMS",
};

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+\n/g, "\n").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain-text update (WhatsApp / SMS / e-mail text part). */
export function notifyText(event: NotifyEvent, p: NotifyPayload, opts: { short?: boolean } = {}): string {
  const who = p.customer ? clip(p.customer, 60) : "לקוח";
  const ch = p.channel ? ` · ${CH[p.channel] ?? p.channel}` : "";
  const max = opts.short ? 220 : 900;
  const lines: string[] = [];
  if (event === "messages") {
    lines.push(`💬 ${p.orgName}${ch}`);
    if (p.customerText) lines.push(`👤 ${who}: ${clip(p.customerText, max)}`);
    if (p.agentText) lines.push(`🤖 ${p.agentName ? clip(p.agentName, 40) : "הסוכן"}: ${clip(p.agentText, max)}`);
  } else if (event === "leads") {
    const l = p.lead ?? {};
    const hot = l.score === "hot" ? "🔥 ליד חם" : l.score === "warm" ? "⭐ ליד חדש" : "🆕 ליד חדש";
    lines.push(`${hot} · ${p.orgName}${ch}`);
    lines.push(`👤 ${clip(l.name || who, 60)}${l.phone ? ` · 📞 ${l.phone}` : ""}${l.email ? ` · ✉️ ${l.email}` : ""}`);
    if (l.need) lines.push(`🎯 ${clip(l.need, 200)}`);
    if (l.budget) lines.push(`💰 ${clip(l.budget, 80)}`);
    if (l.summary) lines.push(`📝 ${clip(l.summary, opts.short ? 160 : 500)}`);
  } else if (event === "handoff") {
    lines.push(`🙋 נדרש נציג · ${p.orgName}${ch}`);
    lines.push(`👤 ${who}${p.reason ? ` · ${clip(p.reason, 80)}` : ""}`);
    if (p.customerText) lines.push(`💬 ${clip(p.customerText, max)}`);
  } else {
    lines.push(`📊 ${p.orgName}`);
    if (p.agentText) lines.push(clip(p.agentText, max));
  }
  if (p.link) lines.push(`🔗 ${p.link}`);
  return lines.join("\n");
}

/** Telegram HTML version (bold header). */
export function notifyTelegramHtml(event: NotifyEvent, p: NotifyPayload): string {
  const [head, ...rest] = notifyText(event, p).split("\n");
  return [`<b>${esc(head ?? "")}</b>`, ...rest.map(esc)].join("\n");
}

export function notifySubject(event: NotifyEvent, p: NotifyPayload): string {
  const who = p.lead?.name || p.customer || "לקוח";
  if (event === "leads") return `${p.lead?.score === "hot" ? "🔥 ליד חם" : "ליד חדש"}: ${clip(who, 60)} · ${p.orgName}`;
  if (event === "handoff") return `🙋 ${clip(who, 60)} מבקש נציג · ${p.orgName}`;
  if (event === "messages") return `💬 שיחה עם ${clip(who, 60)} · ${p.orgName}`;
  return `📊 ${p.orgName}`;
}

export function notifyEmailHtml(event: NotifyEvent, p: NotifyPayload): string {
  const rows = notifyText(event, p)
    .split("\n")
    .filter((l) => !l.startsWith("🔗"))
    .map((l, i) => (i === 0 ? `<h2 style="margin:0 0 12px;font-size:18px">${esc(l)}</h2>` : `<p style="margin:6px 0;line-height:1.6">${esc(l)}</p>`))
    .join("");
  const btn = p.link ? `<p style="margin:18px 0 0"><a href="${esc(p.link)}" style="background:#3b82f6;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;display:inline-block">פתיחה בתיבת ההודעות</a></p>` : "";
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:560px">${rows}${btn}<p style="margin-top:22px;color:#888;font-size:12px">התקבל כי הוגדרתם לקבל עדכונים מ-${esc(p.orgName)}.</p></div>`;
}

/** Invite code for a Telegram recipient (deep link /start n_<code>). */
export function newInviteCode(rnd: () => number = Math.random): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 12 }, () => abc[Math.floor(rnd() * abc.length)]).join("");
}

/** "/start n_<code>" → code; also accepts the bare "n_<code>". */
export function parseNotifyStart(text: string | null | undefined): string | null {
  const m = /^\/start(?:@\w+)?\s+n_([A-Za-z0-9]{8,32})\s*$/.exec((text ?? "").trim());
  return m ? m[1]! : null;
}

export const isStopUpdates = (text: string | null | undefined) => /^\/stop_updates(?:@\w+)?\s*$/i.test((text ?? "").trim());

/** Normalises a recipient target; null when invalid. */
export function normalizeTarget(kind: NotifyKind, raw: string): string | null {
  const v = raw.trim();
  if (kind === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) && v.length <= 200 ? v.toLowerCase() : null;
  if (kind === "whatsapp" || kind === "sms") {
    let d = v.replace(/[^\d+]/g, "");
    if (/^0\d{8,9}$/.test(d)) d = `+972${d.slice(1)}`;
    if (/^\d{9,15}$/.test(d)) d = `+${d}`;
    return /^\+\d{9,15}$/.test(d) ? d : null;
  }
  return null; // telegram: linked by invite
}

/** Telegram target helpers: business chats are stored as "biz:<chat id>". */
export function telegramTarget(externalId: string): { chatId: string; business: boolean } {
  return externalId.startsWith("biz:") ? { chatId: externalId.slice(4), business: true } : { chatId: externalId, business: false };
}
