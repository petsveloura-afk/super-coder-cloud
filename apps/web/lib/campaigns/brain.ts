/**
 * Wave 39 — campaign brain (pure, unit-tested; no I/O).
 * Additive layer on top of wave 17/26: it only READS the message, audience and stats the campaign already has.
 * Nothing here sends, schedules or changes consent rules.
 */
import { campaignRates, type CampaignStats } from "./metrics";

export type Channel = "email" | "whatsapp" | "sms" | "telegram";
export type CheckLevel = "ok" | "warn" | "bad";
export type ScoreLevel = "excellent" | "good" | "fair" | "weak";

/** Merge variables the sender understands (documented in the editor since wave 17). */
export const MERGE_VARS = ["{{contact.first_name}}", "{{org.name}}"] as const;

export const SAMPLE_CONTACT = { first_name: "דנה", org: "העסק שלך" } as const;

/** Fill merge variables with sample values (preview only). */
export function renderPreview(text: string, sample: { first_name?: string; org?: string } = SAMPLE_CONTACT): string {
  return (text ?? "")
    .replace(/\{\{\s*contact\.first_name\s*\}\}/g, sample.first_name ?? "")
    .replace(/\{\{\s*org\.name\s*\}\}/g, sample.org ?? "");
}

/* --------------------------------------------------------------- SMS segments */
// GSM-7 basic charset (+ extension table counts double). Anything else forces UCS-2 (Hebrew/Arabic always do).
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): { encoding: "gsm" | "ucs2"; length: number; segments: number; perSegment: number } {
  const s = text ?? "";
  let gsmLen = 0;
  let gsm = true;
  for (const ch of s) {
    if (GSM_BASIC.includes(ch)) gsmLen += 1;
    else if (GSM_EXT.includes(ch)) gsmLen += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = gsmLen === 0 ? 0 : gsmLen <= 160 ? 1 : Math.ceil(gsmLen / 153);
    return { encoding: "gsm", length: gsmLen, segments, perSegment: gsmLen <= 160 ? 160 : 153 };
  }
  const len = [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
  const segments = len === 0 ? 0 : len <= 70 ? 1 : Math.ceil(len / 67);
  return { encoding: "ucs2", length: len, segments, perSegment: len <= 70 ? 70 : 67 };
}

/* ------------------------------------------------------------- message score */
const SPAM_WORDS = [
  // en
  "free money", "act now", "100% free", "guaranteed", "winner", "click here", "buy now", "no risk", "risk-free", "cash bonus", "urgent!!!", "limited time only",
  // he
  "חינם לגמרי", "הרווחו מיד", "מובטח 100%", "זכית", "לחצו כאן עכשיו", "בלי סיכון", "כסף קל", "פעלו עכשיו",
  // ar
  "مجانا تماما", "ربح مضمون", "لقد فزت", "اضغط هنا الآن", "بدون مخاطرة",
];

const CTA_HINTS = [
  /https?:\/\//i,
  /\b(reply|call|book|buy|order|visit|register|sign up|claim|shop|learn more|get)\b/i,
  /(השיבו|חייגו|התקשרו|הזמינו|קבעו|לרכישה|להרשמה|היכנסו|לפרטים|מימוש|שלחו|ענו)/,
  /(أجب|اتصل|احجز|اطلب|سجل|زر|للمزيد|اضغط)/,
];

export interface MessageCheck {
  id:
    | "length"
    | "personal"
    | "cta"
    | "subject"
    | "spam"
    | "caps"
    | "links"
    | "emoji"
    | "sms_segments"
    | "optout"
    | "template"
    | "shout";
  level: CheckLevel;
  /** i18n params for the message, e.g. {count: 3} */
  params?: Record<string, number | string>;
}

export interface MessageAnalysis {
  score: number;
  level: ScoreLevel;
  checks: MessageCheck[];
  words: number;
  chars: number;
  readingSeconds: number;
  segments: ReturnType<typeof smsSegments> | null;
  spamHits: string[];
}

const IDEAL_WORDS: Record<Channel, [number, number]> = { email: [40, 200], whatsapp: [12, 70], sms: [8, 30], telegram: [12, 90] };

export function levelOf(score: number): ScoreLevel {
  return score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "weak";
}

export function countWords(text: string): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

const emojiCount = (s: string) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;
const linkCount = (s: string) => (s.match(/https?:\/\/\S+/gi) ?? []).length;

export function analyzeMessage(input: { channel: Channel; subject?: string; body: string; hasTemplate?: boolean }): MessageAnalysis {
  const body = (input.body ?? "").trim();
  const subject = (input.subject ?? "").trim();
  const words = countWords(body);
  const chars = body.length;
  const checks: MessageCheck[] = [];
  let score = 100;
  const penalty = (n: number) => {
    score -= n;
  };

  if (!body) {
    return { score: 0, level: "weak", checks: [{ id: "length", level: "bad", params: { count: 0 } }], words: 0, chars: 0, readingSeconds: 0, segments: null, spamHits: [] };
  }

  // length vs. the channel's sweet spot
  const [lo, hi] = IDEAL_WORDS[input.channel];
  if (words < lo) {
    checks.push({ id: "length", level: "warn", params: { count: words, min: lo } });
    penalty(10);
  } else if (words > hi * 1.6) {
    checks.push({ id: "length", level: "bad", params: { count: words, max: hi } });
    penalty(16);
  } else if (words > hi) {
    checks.push({ id: "length", level: "warn", params: { count: words, max: hi } });
    penalty(8);
  } else checks.push({ id: "length", level: "ok", params: { count: words } });

  // personalization
  const personal = /\{\{\s*contact\.first_name\s*\}\}/.test(body) || /\{\{\s*contact\.first_name\s*\}\}/.test(subject);
  checks.push({ id: "personal", level: personal ? "ok" : "warn" });
  if (!personal) penalty(10);

  // call to action
  const cta = CTA_HINTS.some((r) => r.test(body));
  checks.push({ id: "cta", level: cta ? "ok" : "warn" });
  if (!cta) penalty(12);

  // email subject
  if (input.channel === "email") {
    const sl = subject.length;
    if (sl === 0) {
      checks.push({ id: "subject", level: "bad" });
      penalty(20);
    } else if (sl < 12 || sl > 70) {
      checks.push({ id: "subject", level: "warn", params: { count: sl } });
      penalty(8);
    } else checks.push({ id: "subject", level: "ok", params: { count: sl } });
  }

  // spam wording
  const lower = `${subject} ${body}`.toLowerCase();
  const spamHits = SPAM_WORDS.filter((w) => lower.includes(w.toLowerCase()));
  if (spamHits.length) {
    checks.push({ id: "spam", level: spamHits.length > 1 ? "bad" : "warn", params: { count: spamHits.length } });
    penalty(Math.min(24, spamHits.length * 10));
  } else checks.push({ id: "spam", level: "ok" });

  // shouting: !!! and ALL-CAPS words
  const bangs = (`${subject} ${body}`.match(/!{2,}/g) ?? []).length;
  const capsWords = (`${subject} ${body}`.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  if (bangs + capsWords >= 3) {
    checks.push({ id: "shout", level: "bad", params: { count: bangs + capsWords } });
    penalty(14);
  } else if (bangs + capsWords >= 1) {
    checks.push({ id: "shout", level: "warn", params: { count: bangs + capsWords } });
    penalty(5);
  } else checks.push({ id: "shout", level: "ok" });

  // links
  const links = linkCount(body);
  if (links > 2) {
    checks.push({ id: "links", level: "warn", params: { count: links } });
    penalty(8);
  } else checks.push({ id: "links", level: "ok", params: { count: links } });

  // emoji density
  const em = emojiCount(body);
  if (em > 6) {
    checks.push({ id: "emoji", level: "warn", params: { count: em } });
    penalty(5);
  }

  // SMS cost
  let segments: MessageAnalysis["segments"] = null;
  if (input.channel === "sms") {
    segments = smsSegments(body);
    const lvl: CheckLevel = segments.segments <= 1 ? "ok" : segments.segments <= 3 ? "warn" : "bad";
    checks.push({ id: "sms_segments", level: lvl, params: { count: segments.segments } });
    if (lvl === "warn") penalty(6);
    if (lvl === "bad") penalty(14);
  }

  // marketing messages should tell people how to leave
  if (input.channel !== "whatsapp" || !input.hasTemplate) {
    const optout = /(הסר|להסרה|unsubscribe|stop|opt.?out|إلغاء|توقف)/i.test(body);
    checks.push({ id: "optout", level: optout ? "ok" : "warn" });
    if (!optout) penalty(4);
  }

  if (input.channel === "whatsapp") {
    checks.push({ id: "template", level: input.hasTemplate ? "ok" : "warn" });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: levelOf(score), checks, words, chars, readingSeconds: Math.max(1, Math.round(words / 3.3)), segments, spamHits };
}

/* ------------------------------------------------------------------ readiness */
export interface ReadinessInput {
  channel: Channel;
  channelConnected: boolean;
  name: string;
  body: string;
  subject?: string;
  audienceCount: number | null;
  scheduledAt?: string | null;
  messageScore: number;
  hasTemplate?: boolean;
  dirty?: boolean;
  now?: number;
}

export interface ReadinessItem {
  id: "name" | "message" | "channel" | "audience" | "schedule" | "quality" | "template" | "saved";
  level: CheckLevel;
  params?: Record<string, number | string>;
}

export function readiness(i: ReadinessInput): { items: ReadinessItem[]; ready: boolean; percent: number } {
  const now = i.now ?? Date.now();
  const items: ReadinessItem[] = [];
  items.push({ id: "name", level: i.name.trim() ? "ok" : "bad" });
  const msgOk = i.body.trim().length > 0 && (i.channel !== "email" || (i.subject ?? "").trim().length > 0);
  items.push({ id: "message", level: msgOk ? "ok" : "bad" });
  items.push({ id: "channel", level: i.channelConnected ? "ok" : "bad" });
  items.push({ id: "audience", level: i.audienceCount === null ? "warn" : i.audienceCount > 0 ? "ok" : "bad", params: { count: i.audienceCount ?? 0 } });
  if (i.scheduledAt) {
    const t = Date.parse(i.scheduledAt);
    items.push({ id: "schedule", level: Number.isNaN(t) || t < now - 60_000 ? "bad" : "ok" });
  } else items.push({ id: "schedule", level: "ok" });
  items.push({ id: "quality", level: i.messageScore >= 70 ? "ok" : i.messageScore >= 50 ? "warn" : "bad", params: { score: i.messageScore } });
  if (i.channel === "whatsapp") items.push({ id: "template", level: i.hasTemplate ? "ok" : "warn" });
  if (i.dirty) items.push({ id: "saved", level: "warn" });
  const ready = items.every((x) => x.level !== "bad") && i.audienceCount !== null && !i.dirty;
  const weight = { ok: 1, warn: 0.5, bad: 0 } as const;
  const percent = Math.round((items.reduce((n, x) => n + weight[x.level], 0) / items.length) * 100);
  return { items, ready, percent };
}

/* ------------------------------------------------------------ send-time ideas */
export interface SendSlot {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  hour: number;
  reason: "midweek_morning" | "lunch" | "evening" | "sunday_start";
}

/**
 * Best-practice windows for Israeli business audiences (Sun–Thu working week, quiet Friday night / Saturday).
 * Returns the next few concrete local dates, never in the past.
 */
export function suggestSendTimes(channel: Channel, from: Date = new Date(), count = 3): { at: Date; reason: SendSlot["reason"] }[] {
  const plan: Record<Channel, SendSlot[]> = {
    email: [
      { day: 2, hour: 10, reason: "midweek_morning" },
      { day: 4, hour: 9, reason: "midweek_morning" },
      { day: 0, hour: 9, reason: "sunday_start" },
    ],
    whatsapp: [
      { day: 2, hour: 12, reason: "lunch" },
      { day: 3, hour: 19, reason: "evening" },
      { day: 0, hour: 18, reason: "evening" },
    ],
    sms: [
      { day: 1, hour: 11, reason: "midweek_morning" },
      { day: 3, hour: 12, reason: "lunch" },
      { day: 4, hour: 10, reason: "midweek_morning" },
    ],
    telegram: [
      { day: 2, hour: 20, reason: "evening" },
      { day: 4, hour: 12, reason: "lunch" },
      { day: 0, hour: 19, reason: "evening" },
    ],
  };
  const out: { at: Date; reason: SendSlot["reason"] }[] = [];
  for (const slot of plan[channel]) {
    const d = new Date(from.getTime());
    d.setHours(slot.hour, 0, 0, 0);
    let add = (slot.day - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= from.getTime() + 30 * 60_000) add = 7;
    d.setDate(d.getDate() + add);
    out.push({ at: d, reason: slot.reason });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, Math.max(1, count));
}

/* -------------------------------------------------------- audience quick picks */
export const AUDIENCE_PRESETS = [
  { id: "hot", audience: { min_score: 70 } },
  { id: "warm", audience: { min_score: 40, max_score: 69 } },
  { id: "inactive30", audience: { inactive_days: 30 } },
  { id: "inactive90", audience: { inactive_days: 90 } },
  { id: "active7", audience: { active_days: 7 } },
  { id: "customers", audience: { stage: "customer" } },
  { id: "big_spenders", audience: { purchases_min: 1000 } },
  { id: "ready", audience: { stage: "ready" } },
] as const;
export type AudiencePresetId = (typeof AUDIENCE_PRESETS)[number]["id"];

/* ---------------------------------------------------------------- performance */
export type InsightKey =
  | "high_failure"
  | "low_delivery"
  | "great_delivery"
  | "stuck_sending"
  | "small_audience"
  | "scheduled_soon"
  | "sms_cost"
  | "draft_waiting"
  | "channel_best";

export interface InsightRow {
  key: InsightKey;
  level: CheckLevel;
  params?: Record<string, number | string>;
}

export interface PerfCampaign {
  id?: string;
  name?: string;
  status: string;
  channel: string;
  stats?: CampaignStats | null;
  launched_at?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
}

/** Insights for ONE finished / running campaign. */
export function campaignInsights(c: PerfCampaign, now = Date.now()): InsightRow[] {
  const r = campaignRates(c.stats);
  const out: InsightRow[] = [];
  const done = r.sent + r.failed;
  if (done >= 10 && r.failureRate >= 0.15) out.push({ key: "high_failure", level: r.failureRate >= 0.3 ? "bad" : "warn", params: { pct: Math.round(r.failureRate * 100) } });
  if (c.status === "sent" && r.recipients >= 20 && r.deliveryRate < 0.85 && r.failureRate < 0.15) out.push({ key: "low_delivery", level: "warn", params: { pct: Math.round(r.deliveryRate * 100) } });
  if (c.status === "sent" && r.recipients >= 20 && r.deliveryRate >= 0.97) out.push({ key: "great_delivery", level: "ok", params: { pct: Math.round(r.deliveryRate * 100) } });
  if (c.status === "sending" && c.launched_at) {
    const hours = (now - Date.parse(c.launched_at)) / 3_600_000;
    if (hours > 3 && r.progress < 0.9) out.push({ key: "stuck_sending", level: "warn", params: { hours: Math.floor(hours) } });
  }
  if (r.recipients > 0 && r.recipients < 20 && c.status !== "draft") out.push({ key: "small_audience", level: "warn", params: { count: r.recipients } });
  if (c.status === "scheduled" && c.scheduled_at) {
    const mins = (Date.parse(c.scheduled_at) - now) / 60_000;
    if (mins > 0 && mins < 120) out.push({ key: "scheduled_soon", level: "ok", params: { mins: Math.max(1, Math.round(mins)) } });
  }
  return out;
}

/** Insights across the whole list. */
export function portfolioInsights(rows: PerfCampaign[], now = Date.now()): InsightRow[] {
  const out: InsightRow[] = [];
  const sent = rows.filter((r) => r.status === "sent");
  const byChannel = new Map<string, { sent: number; rec: number }>();
  for (const r of sent) {
    const x = campaignRates(r.stats);
    const cur = byChannel.get(r.channel) ?? { sent: 0, rec: 0 };
    cur.sent += x.sent;
    cur.rec += x.recipients;
    byChannel.set(r.channel, cur);
  }
  const ranked = [...byChannel.entries()].filter(([, v]) => v.rec >= 30).map(([k, v]) => ({ k, rate: v.sent / v.rec })).sort((a, b) => b.rate - a.rate);
  if (ranked.length >= 2 && ranked[0]!.rate - ranked[ranked.length - 1]!.rate >= 0.05) out.push({ key: "channel_best", level: "ok", params: { channel: ranked[0]!.k, pct: Math.round(ranked[0]!.rate * 100) } });
  const oldDrafts = rows.filter((r) => r.status === "draft" && r.created_at && now - Date.parse(r.created_at) > 7 * 86_400_000).length;
  if (oldDrafts > 0) out.push({ key: "draft_waiting", level: "warn", params: { count: oldDrafts } });
  const stuck = rows.filter((r) => r.status === "sending" && r.launched_at && now - Date.parse(r.launched_at) > 3 * 3_600_000).length;
  if (stuck > 0) out.push({ key: "stuck_sending", level: "warn", params: { count: stuck, hours: 3 } });
  return out;
}

/** Delivery performance per channel, for the "by channel" bars. */
export function channelPerformance(rows: PerfCampaign[]): { channel: string; campaigns: number; sent: number; recipients: number; rate: number }[] {
  const m = new Map<string, { campaigns: number; sent: number; recipients: number }>();
  for (const r of rows) {
    if (r.status === "draft") continue;
    const x = campaignRates(r.stats);
    const cur = m.get(r.channel) ?? { campaigns: 0, sent: 0, recipients: 0 };
    cur.campaigns += 1;
    cur.sent += x.sent;
    cur.recipients += x.recipients;
    m.set(r.channel, cur);
  }
  return [...m.entries()].map(([channel, v]) => ({ channel, ...v, rate: v.recipients ? v.sent / v.recipients : 0 })).sort((a, b) => b.sent - a.sent);
}

/** Last N months of recipients/sent, for the small trend chart. */
export function monthlyTrend(rows: PerfCampaign[], months = 6, now: Date = new Date()): { key: string; sent: number; recipients: number }[] {
  const buckets: { key: string; sent: number; recipients: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, sent: 0, recipients: 0 });
  }
  for (const r of rows) {
    const at = r.launched_at ?? r.scheduled_at ?? r.created_at;
    if (!at || r.status === "draft") continue;
    const d = new Date(at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.find((x) => x.key === key);
    if (!b) continue;
    const x = campaignRates(r.stats);
    b.sent += x.sent;
    b.recipients += x.recipients;
  }
  return buckets;
}

/**
 * Same windows as suggestSendTimes, but computed in the CUSTOMER's wall clock (tzOffsetMin = Date#getTimezoneOffset of
 * the browser) with UTC getters only — so it is correct on a server running in any timezone. Returns real instants.
 */
export function suggestSendInstants(channel: Channel, nowMs: number, tzOffsetMin: number, count = 3): { atMs: number; reason: SendSlot["reason"] }[] {
  const wallNow = nowMs - tzOffsetMin * 60_000; // UTC fields of this Date == the user's wall clock
  const plan: Record<Channel, SendSlot[]> = {
    email: [{ day: 2, hour: 10, reason: "midweek_morning" }, { day: 4, hour: 9, reason: "midweek_morning" }, { day: 0, hour: 9, reason: "sunday_start" }],
    whatsapp: [{ day: 2, hour: 12, reason: "lunch" }, { day: 3, hour: 19, reason: "evening" }, { day: 0, hour: 18, reason: "evening" }],
    sms: [{ day: 1, hour: 11, reason: "midweek_morning" }, { day: 3, hour: 12, reason: "lunch" }, { day: 4, hour: 10, reason: "midweek_morning" }],
    telegram: [{ day: 2, hour: 20, reason: "evening" }, { day: 4, hour: 12, reason: "lunch" }, { day: 0, hour: 19, reason: "evening" }],
  };
  const out = plan[channel].map((slot) => {
    const d = new Date(wallNow);
    d.setUTCHours(slot.hour, 0, 0, 0);
    let add = (slot.day - d.getUTCDay() + 7) % 7;
    if (add === 0 && d.getTime() <= wallNow + 30 * 60_000) add = 7;
    d.setUTCDate(d.getUTCDate() + add);
    return { atMs: d.getTime() + tzOffsetMin * 60_000, reason: slot.reason };
  });
  return out.sort((a, b) => a.atMs - b.atMs).slice(0, Math.max(1, count));
}
