/** sender names that are always an automatic e-mail, never a customer (pure, unit-tested) */
const ROBOT_NAME = /^(mail delivery (subsystem|system)|mailer[- ]daemon|postmaster|no[- ]?reply|do[- ]?not[- ]?reply|notifications?|microsoft outlook|google( workspace)? (alerts|calendar)|delivery status notification)\b/i;

export function isRobotName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (ROBOT_NAME.test(n)) return true;
  return /^(no-?reply|noreply|mailer-daemon|postmaster|notifications?|bounce[s]?)@/i.test(n);
}

/* ------------------------------------------------------------------ service senders (additive, wider net) */

/**
 * Well-known service / platform senders (exchanges, banks, app platforms, cloud tools, shops). Matched only as the WHOLE
 * conversation title (optionally followed by a role word such as "Alerts", "Security", "Team", "Support"), so a customer
 * called "Max Cohen" or a business called "Neon Hair" is never caught — only "Max", "Neon Alerts", "OKX", "Bybit" …
 */
const SERVICE_BRANDS = [
  "okx", "bybit", "binance", "coinbase", "kraken", "kucoin", "bitget", "mexc", "gate\\.io", "crypto\\.com", "metamask", "trust wallet", "ledger",
  "telegram", "whatsapp", "meta", "facebook", "instagram", "messenger", "google", "gmail", "youtube", "apple", "icloud", "microsoft", "outlook", "linkedin", "twitter", "tiktok",
  "paypal", "stripe", "payoneer", "revolut", "paybox", "isracard", "leumi", "hapoalim", "discount", "mizrahi",
  "neon", "vercel", "supabase", "github", "gitlab", "render", "railway", "netlify", "cloudflare", "heroku", "aws", "amazon web services", "namecheap", "godaddy", "hostinger", "wix", "shopify", "wordpress",
  "amazon", "aliexpress", "temu", "shein", "ebay", "netflix", "spotify", "uber", "wolt", "zoom", "slack", "notion", "canva", "figma", "openai", "chatgpt", "anthropic", "elevenlabs", "zapier", "mailchimp", "sendgrid", "twilio",
];
const ROLE = "(?:\\s+(?:alerts?|security|team|support|notifications?|notify|no-?reply|info|updates?|billing|accounts?|service|bot|wallet|exchange|pay|business|ads|for business|ישראל|israel))*";
const SERVICE_TITLE = new RegExp(`^(?:${SERVICE_BRANDS.join("|")})${ROLE}\\.?$`, "i");
const SERVICE_ROLE_TITLE = /^[\p{L}\p{N} .&-]{1,30}\s+(?:alerts?|security|notifications?|no-?reply|billing)$/iu;

/** texts that only machines send: login / verification codes, IP + device reports, long opaque tokens */
const MACHINE_TEXT = [
  /\b(?:login|verification|security|one[- ]time|confirmation|auth(?:entication)?)\s+code\b/i,
  /\byour code (?:is|:)/i,
  /\b(?:new )?(?:login|sign[- ]in) (?:attempt|from|detected|alert)\b/i,
  /\bIP(?: address)?\s*:\s*[0-9a-f:.]{6,}/i,
  /קוד (?:ה)?(?:אימות|כניסה|אבטחה)|סיסמה חד[- ]פעמית|התחברות חדשה (?:לחשבון|מ)/,
  /رمز (?:التحقق|الدخول)|كلمة مرور لمرة واحدة/,
  /(?:^|[\s…]|\.\.\.)[A-Za-z0-9_-]{36,}(?:\s|$|…|\.\.\.)/, // a long opaque token (a link key, an API token)
];

/** is this conversation a service / platform sender and not a customer? (title + latest preview) */
/**
 * A Messenger / Instagram conversation is titled "Messenger" / "Instagram" until the customer's real name is read from
 * Meta (it can be slow or not allowed). That title is OUR placeholder for a real person — never a service sender.
 * Before this, such customers were treated as a robot: the agent did not answer them and the inbox hid them.
 */
export function isChannelPlaceholderTitle(title: string | null | undefined, channel: string | null | undefined): boolean {
  return (channel === "instagram" || channel === "messenger") && /^(instagram|messenger|facebook)$/i.test(String(title ?? "").trim());
}

export function isServiceSender(title: string | null | undefined, preview?: string | null, channel?: string | null): boolean {
  if (channel && isChannelPlaceholderTitle(title, channel)) title = "";
  const n = (title ?? "").trim().replace(/\s+/g, " ");
  if (n && (SERVICE_TITLE.test(n) || SERVICE_ROLE_TITLE.test(n) || isRobotName(n))) return true;
  const p = (preview ?? "").trim();
  return p.length > 0 && MACHINE_TEXT.some((r) => r.test(p));
}
