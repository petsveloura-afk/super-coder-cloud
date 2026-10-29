/**
 * Wave 51 — rich social posts, pure logic (unit-tested): link, call-to-action button, video and first comment.
 *
 * Facebook: a text post with a link becomes a real link card; the button is added as Meta's call_to_action when the
 * API accepts it, otherwise as a clear text line with the link (so the post is never lost).
 * Instagram: captions cannot hold clickable links, so the button becomes a short text line ("💬 send us a DM").
 */

export const CTA_TYPES = ["message", "whatsapp", "call", "book", "learn_more", "shop", "sign_up", "order"] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export interface Cta {
  type: CtaType;
  /** phone for whatsapp / call, URL for the link types; unused for "message" */
  value?: string | null;
}

export function isCtaType(v: unknown): v is CtaType {
  return typeof v === "string" && (CTA_TYPES as readonly string[]).includes(v);
}

/** Digits of a phone in international form (Israeli 05x → 9725x). */
export function intlPhone(raw: string): string {
  let d = (raw ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (/^0\d{8,9}$/.test(d)) d = `972${d.slice(1)}`;
  return d.replace(/\D/g, "");
}

/** The URL behind a button (null when the button needs a value it does not have). */
export function ctaUrl(cta: Cta, ctx: { pageId?: string | null; igUsername?: string | null; platform: "facebook" | "instagram" }): string | null {
  const v = (cta.value ?? "").trim();
  switch (cta.type) {
    case "message":
      if (ctx.platform === "instagram") return ctx.igUsername ? `https://ig.me/m/${ctx.igUsername}` : null;
      return ctx.pageId ? `https://m.me/${ctx.pageId}` : null;
    case "whatsapp": {
      const p = intlPhone(v);
      return p.length >= 9 ? `https://wa.me/${p}` : null;
    }
    case "call": {
      const p = intlPhone(v);
      return p.length >= 9 ? `tel:+${p}` : null;
    }
    default:
      return /^https?:\/\/\S+$/i.test(v) ? v : null;
  }
}

const LABELS: Record<"he" | "en" | "ar", Record<CtaType, string>> = {
  he: { message: "💬 שלחו לנו הודעה", whatsapp: "🟢 כתבו לנו בוואטסאפ", call: "📞 התקשרו עכשיו", book: "📅 לקביעת תור", learn_more: "👉 לפרטים נוספים", shop: "🛍️ לקנייה", sign_up: "✍️ להרשמה", order: "🛒 להזמנה" },
  en: { message: "💬 Send us a message", whatsapp: "🟢 Chat on WhatsApp", call: "📞 Call now", book: "📅 Book now", learn_more: "👉 Learn more", shop: "🛍️ Shop now", sign_up: "✍️ Sign up", order: "🛒 Order now" },
  ar: { message: "💬 راسلونا", whatsapp: "🟢 تواصلوا عبر واتساب", call: "📞 اتصلوا الآن", book: "📅 احجزوا موعداً", learn_more: "👉 لمزيد من التفاصيل", shop: "🛍️ تسوقوا الآن", sign_up: "✍️ سجلوا الآن", order: "🛒 اطلبوا الآن" },
};

export function ctaLabel(type: CtaType, lang: string): string {
  return (LABELS[lang === "en" || lang === "ar" ? lang : "he"] ?? LABELS.he)[type];
}

/** Text line for the button (used on Instagram and as the Facebook fallback). */
export function ctaLine(cta: Cta, ctx: { pageId?: string | null; igUsername?: string | null; platform: "facebook" | "instagram"; lang: string }): string | null {
  const label = ctaLabel(cta.type, ctx.lang);
  const url = ctaUrl(cta, ctx);
  if (ctx.platform === "instagram") {
    // links are not clickable in Instagram captions: point to DM / bio / the phone number instead
    if (cta.type === "message") return label;
    if (cta.type === "call" || cta.type === "whatsapp") {
      const p = intlPhone(cta.value ?? "");
      return p ? `${label}: +${p}` : label;
    }
    return `${label} — ${ctx.lang === "en" ? "link in bio" : ctx.lang === "ar" ? "الرابط في البايو" : "קישור בביו"}`;
  }
  if (!url) return null;
  return `${label}: ${url.replace(/^tel:/, "")}`;
}

/** Meta's call_to_action object for a Facebook link post (null when the type has no native button). */
export function fbCallToAction(cta: Cta, link: string | null, pageId?: string | null): { type: string; value: Record<string, string> } | null {
  const url = ctaUrl(cta, { pageId, platform: "facebook" });
  switch (cta.type) {
    case "message":
      return { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } };
    case "whatsapp":
      return url ? { type: "WHATSAPP_MESSAGE", value: { link: url } } : null;
    case "call":
      return url ? { type: "CALL_NOW", value: { link: url } } : null;
    case "book":
      return url || link ? { type: "BOOK_NOW", value: { link: (url ?? link)! } } : null;
    case "shop":
      return url || link ? { type: "SHOP_NOW", value: { link: (url ?? link)! } } : null;
    case "sign_up":
      return url || link ? { type: "SIGN_UP", value: { link: (url ?? link)! } } : null;
    case "order":
      return url || link ? { type: "ORDER_NOW", value: { link: (url ?? link)! } } : null;
    default:
      return url || link ? { type: "LEARN_MORE", value: { link: (url ?? link)! } } : null;
  }
}

/**
 * Final caption for a platform: the post text + (when it cannot be attached natively) the link line and the button line.
 * Never duplicates a link that is already in the text.
 */
export function composeCaption(input: {
  body: string;
  link?: string | null;
  cta?: Cta | null;
  platform: "facebook" | "instagram";
  lang: string;
  /** true when the link is attached natively (Facebook link card) — then it is not repeated in the text */
  linkAttached?: boolean;
  /** true when the button is attached natively (Facebook call_to_action) */
  ctaAttached?: boolean;
  pageId?: string | null;
  igUsername?: string | null;
}): string {
  const lines = [input.body.trim()];
  const link = (input.link ?? "").trim();
  if (link && !input.linkAttached && !input.body.includes(link)) {
    lines.push(input.platform === "instagram" ? `🔗 ${input.lang === "en" ? "Link in bio" : input.lang === "ar" ? "الرابط في البايو" : "הקישור בביו"}` : `🔗 ${link}`);
  }
  if (input.cta && !input.ctaAttached) {
    const line = ctaLine(input.cta, { pageId: input.pageId, igUsername: input.igUsername, platform: input.platform, lang: input.lang });
    if (line && !lines.some((l) => l.includes(line))) lines.push(line);
  }
  const max = input.platform === "instagram" ? 2200 : 5000;
  return lines.join("\n\n").slice(0, max);
}

/** Video by extension or known content-type hint. */
export function isVideoUrl(url: string | null | undefined): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url ?? "");
}

/** Upload rules for files from the device (checked on the server before a signed upload URL is issued). */
export const UPLOAD_LIMITS = { imageBytes: 10 * 1024 * 1024, videoBytes: 50 * 1024 * 1024 };
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function uploadCheck(input: { type: string; size: number }): { ok: true; ext: string; kind: "image" | "video" } | { ok: false; error: "type" | "size" } {
  const ext = MIME_EXT[(input.type ?? "").toLowerCase()];
  if (!ext) return { ok: false, error: "type" };
  const kind = input.type.startsWith("video/") ? "video" : "image";
  const max = kind === "video" ? UPLOAD_LIMITS.videoBytes : UPLOAD_LIMITS.imageBytes;
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > max) return { ok: false, error: "size" };
  return { ok: true, ext, kind };
}

/** Is the post "rich" (needs the new publishing path)? Old posts keep the original path untouched. */
export function isRichPost(p: { link_url?: string | null; video_url?: string | null; cta_type?: string | null; first_comment?: string | null }): boolean {
  return Boolean(p.link_url || p.video_url || p.cta_type || p.first_comment);
}
