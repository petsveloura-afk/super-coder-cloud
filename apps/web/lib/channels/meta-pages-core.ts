/**
 * Wave 19 — Facebook Messenger + Instagram Direct + comments (pure, unit-tested).
 * One Meta app webhook delivers both:
 *   object "page"       → entry.id = Facebook Page id      (Messenger + page comments)
 *   object "instagram"  → entry.id = Instagram account id   (Instagram Direct + comments)
 */
export type SocialPlatform = "messenger" | "instagram";

export interface PageMessage {
  platform: SocialPlatform;
  /** the business side: Page id / Instagram account id */
  accountId: string;
  /** the customer: PSID / IGSID */
  senderId: string;
  mid: string;
  text: string;
  /** a message the business sent itself (Meta inbox / phone app) */
  echo: boolean;
  /** our own app sent it (skip) */
  echoAppId?: string | null;
  media: { type: string; url?: string; name?: string } | null;
  postback?: string | null;
  referral?: string | null;
}

export interface PageComment {
  platform: "facebook" | "instagram";
  accountId: string;
  commentId: string;
  postId: string | null;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  text: string;
  /** "add" only — edits / removals are ignored */
  verb: string;
}

interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; attachments?: { type?: string; payload?: { url?: string; title?: string } }[]; quick_reply?: { payload?: string }; is_deleted?: boolean };
  postback?: { title?: string; payload?: string; mid?: string };
  referral?: { ref?: string; source?: string };
}

interface RawChange {
  field?: string;
  value?: {
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    parent_id?: string;
    from?: { id?: string; name?: string; username?: string };
    message?: string;
    // instagram comments
    id?: string;
    text?: string;
    media?: { id?: string };
  };
}

export interface RawPagesWebhook {
  object?: string;
  entry?: { id?: string; messaging?: RawMessaging[]; changes?: RawChange[] }[];
}

const idOk = (v: unknown): v is string => typeof v === "string" && /^\d{3,40}$/.test(v);

export function parsePagesWebhook(body: RawPagesWebhook): { messages: PageMessage[]; comments: PageComment[] } {
  const messages: PageMessage[] = [];
  const comments: PageComment[] = [];
  const platform: SocialPlatform | null = body.object === "page" ? "messenger" : body.object === "instagram" ? "instagram" : null;
  if (!platform) return { messages, comments };
  for (const entry of body.entry ?? []) {
    const accountId = entry.id ?? "";
    if (!idOk(accountId)) continue;
    for (const ev of entry.messaging ?? []) {
      const echo = Boolean(ev.message?.is_echo);
      // the customer is the sender — except for echoes, where the business is the sender
      const senderId = echo ? ev.recipient?.id : ev.sender?.id;
      if (!idOk(senderId) || senderId === accountId) continue;
      if (ev.message?.is_deleted) continue;
      const att = ev.message?.attachments?.[0];
      const media = att?.type ? { type: att.type === "image" ? "image" : att.type === "audio" ? "audio" : att.type === "file" ? "document" : att.type, ...(att.payload?.url && /^https:\/\//.test(att.payload.url) ? { url: att.payload.url } : {}), ...(att.payload?.title ? { name: att.payload.title.slice(0, 200) } : {}) } : null;
      const postback = ev.postback?.payload ?? ev.message?.quick_reply?.payload ?? null;
      const text = (ev.message?.text ?? ev.postback?.title ?? "").slice(0, 8000);
      const mid = ev.message?.mid ?? ev.postback?.mid ?? "";
      if (!mid && !text) continue;
      if (!text && !media) continue;
      messages.push({
        platform,
        accountId,
        senderId,
        mid: mid || `${senderId}:${text.slice(0, 20)}`,
        text,
        echo,
        echoAppId: ev.message?.app_id != null ? String(ev.message.app_id) : null,
        media,
        postback: postback ? String(postback).slice(0, 200) : null,
        referral: ev.referral?.ref ? String(ev.referral.ref).slice(0, 200) : null,
      });
    }
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (platform === "messenger" && ch.field === "feed" && v.item === "comment") {
        if (!v.comment_id || (v.verb && v.verb !== "add")) continue;
        if (v.from?.id === accountId) continue; // the page's own replies
        comments.push({ platform: "facebook", accountId, commentId: String(v.comment_id).slice(0, 120), postId: v.post_id ? String(v.post_id).slice(0, 120) : null, parentId: v.parent_id && v.parent_id !== v.post_id ? String(v.parent_id).slice(0, 120) : null, authorId: v.from?.id ?? null, authorName: v.from?.name ? v.from.name.slice(0, 160) : null, text: String(v.message ?? "").slice(0, 8000), verb: v.verb ?? "add" });
      }
      if (platform === "instagram" && (ch.field === "comments" || ch.field === "live_comments")) {
        if (!v.id) continue;
        if (v.from?.id === accountId) continue;
        comments.push({ platform: "instagram", accountId, commentId: String(v.id).slice(0, 120), postId: v.media?.id ? String(v.media.id).slice(0, 120) : null, parentId: v.parent_id ? String(v.parent_id).slice(0, 120) : null, authorId: v.from?.id ?? null, authorName: (v.from?.username ?? v.from?.name ?? null)?.slice(0, 160) ?? null, text: String(v.text ?? "").slice(0, 8000), verb: "add" });
      }
    }
  }
  return { messages, comments };
}

/** Quick replies for Messenger / Instagram (max 13, title ≤ 20 chars). */
export function quickReplies(buttons: string[] | undefined): { content_type: "text"; title: string; payload: string }[] | undefined {
  const list = (buttons ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 13);
  if (!list.length) return undefined;
  return list.map((b) => ({ content_type: "text" as const, title: b.length > 20 ? `${b.slice(0, 19)}…` : b, payload: b.slice(0, 900) }));
}

/** Meta limits: Instagram 1000 bytes per text, Messenger 2000 chars — split on paragraph / sentence borders. */
export function splitForMeta(text: string, platform: SocialPlatform): string[] {
  const limitBytes = platform === "instagram" ? 990 : 1990;
  const enc = new TextEncoder();
  const out: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (enc.encode(rest).length <= limitBytes) {
      out.push(rest);
      break;
    }
    // find the longest prefix within the limit, prefer a paragraph / sentence end
    let lo = 1;
    let hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (enc.encode(rest.slice(0, mid)).length <= limitBytes) lo = mid;
      else hi = mid - 1;
    }
    const chunk = rest.slice(0, lo);
    const cut = Math.max(chunk.lastIndexOf("\n\n"), chunk.lastIndexOf("\n"), chunk.lastIndexOf(". "), chunk.lastIndexOf("? "), chunk.lastIndexOf("! "));
    const at = cut > lo * 0.5 ? cut + 1 : lo;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
    if (out.length >= 6) break;
  }
  return out.filter(Boolean);
}

/** A comment that looks like buying intent → the agent also opens a private DM. */
export function commentIntent(text: string): "lead" | "question" | "negative" | "spam" | "positive" | "neutral" {
  const t = text.toLowerCase();
  if (/https?:\/\/|www\.|t\.me\/|bit\.ly|\b(?:crypto|bitcoin|forex|casino)\b/.test(t)) return "spam";
  if (/מחיר|כמה עולה|כמה זה|פרטים|פרטיים|במחיר|הזמנה|להזמין|זמין|יש במלאי|מעוניינ|price|how much|cost|available|order|interested|dm|inbox|السعر|كم|بكم|مهتم|اطلب/.test(t)) return "lead";
  if (/\?|؟|איך|מתי|איפה|האם|how|when|where|can i|هل|متى|أين|كيف/.test(t)) return "question";
  if (/גרוע|נורא|לא מרוצ|נוכל|רמאי|בושה|worst|scam|terrible|awful|disappointed|سيء|نصاب|محتال/.test(t)) return "negative";
  if (/מדהים|יפה|אהבתי|תודה|מושלם|❤|😍|👏|amazing|love|great|beautiful|thank|رائع|جميل|شكرا/.test(t)) return "positive";
  return "neutral";
}
