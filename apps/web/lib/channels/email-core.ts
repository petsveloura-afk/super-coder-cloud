/**
 * E-mail channel — pure helpers (unit-tested): provider presets by address,
 * quoted-reply stripping and reply subjects.
 */

export type MailProvider = "gmail" | "outlook" | "yahoo" | "icloud" | "zoho" | "other";

export interface MailServers {
  provider: MailProvider;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  /** where the customer creates an app password */
  app_password_url: string | null;
}

const PRESETS: Record<Exclude<MailProvider, "other">, Omit<MailServers, "provider">> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, app_password_url: "https://myaccount.google.com/apppasswords" },
  outlook: { imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587, app_password_url: "https://account.live.com/proofs/AppPassword" },
  yahoo: { imap_host: "imap.mail.yahoo.com", imap_port: 993, smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, app_password_url: "https://login.yahoo.com/account/security" },
  icloud: { imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587, app_password_url: "https://account.apple.com/account/manage" },
  zoho: { imap_host: "imap.zoho.com", imap_port: 993, smtp_host: "smtp.zoho.com", smtp_port: 465, app_password_url: "https://accounts.zoho.com/home#security/app_password" },
};

const DOMAINS: [RegExp, Exclude<MailProvider, "other">][] = [
  [/^(gmail|googlemail)\.com$/, "gmail"],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, "outlook"],
  [/^(yahoo|ymail)\.[a-z.]+$/, "yahoo"],
  [/^(icloud|me|mac)\.com$/, "icloud"],
  [/^zoho(mail)?\.[a-z.]+$/, "zoho"],
];

/** Detects the mail servers from the address; business domains fall back to mail.<domain>. */
export function detectMailServers(address: string): MailServers {
  const domain = (address.split("@")[1] ?? "").toLowerCase().trim();
  for (const [re, p] of DOMAINS) if (re.test(domain)) return { provider: p, ...PRESETS[p] };
  return { provider: "other", imap_host: domain ? `imap.${domain}` : "", imap_port: 993, smtp_host: domain ? `smtp.${domain}` : "", smtp_port: 465, app_password_url: null };
}

export function presetFor(provider: MailProvider): Omit<MailServers, "provider"> | null {
  return provider === "other" ? null : PRESETS[provider];
}

/** Keeps only the new part of a reply (drops quoted history and common signatures markers). */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const l = line.trim();
    if (/^>/.test(l)) break;
    if (/^On .{4,200} wrote:$/i.test(l)) break;
    if (/^ב?תאריך .{2,200} (?:כתב|כתבה|כתבו)/.test(l)) break;
    if (/^-{2,}\s*(?:Original Message|הודעה מקורית)\s*-{2,}$/i.test(l)) break;
    if (/^(?:From|מאת):\s.+/i.test(l) && out.length > 0) break;
    if (/^_{8,}$/.test(l)) break;
    if (/^Sent from my (?:iPhone|Android|iPad)/i.test(l) || /^נשלח מה-?(?:iPhone|אנדרואיד)/.test(l)) break;
    out.push(line);
  }
  const result = out.join("\n").trim();
  return (result || text.trim()).slice(0, 8000);
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re:";
  return /^(re|השב|תגובה)\s*:/i.test(s) ? s.slice(0, 250) : `Re: ${s}`.slice(0, 250);
}

/** Message-ID references for threading the answer under the customer's e-mail. */
export function threadHeaders(meta: { message_id?: string | null; references?: string | null }): Record<string, string> {
  const id = (meta.message_id ?? "").trim();
  if (!id) return {};
  const refs = [(meta.references ?? "").trim(), id].filter(Boolean).join(" ").slice(-1800);
  return { "In-Reply-To": id, References: refs };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Professional HTML version of a reply (the plain-text body is sent alongside).
 * Everything is escaped; only https/http links and line breaks become markup.
 */
export function renderEmailHtml(text: string, opts: { brand?: string; dir?: "rtl" | "ltr"; accent?: string } = {}): string {
  const dir = opts.dir ?? (/[֐-ۿ]/.test(text) ? "rtl" : "ltr");
  const accent = /^#[0-9a-f]{6}$/i.test(opts.accent ?? "") ? opts.accent! : "#3366E6";
  const align = dir === "rtl" ? "right" : "left";
  const paragraphs = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => {
      const html = escapeHtml(p)
        .replace(/(https?:\/\/[^\s<>"']+)/g, (u) => `<a href="${u}" style="color:${accent};text-decoration:underline">${u}</a>`)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px;line-height:1.65">${html}</p>`;
    })
    .join("");
  const brand = opts.brand ? escapeHtml(opts.brand) : "";
  return [
    `<!doctype html><html dir="${dir}"><body style="margin:0;padding:0;background:#f4f6fb">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e9f2">`,
    brand ? `<tr><td style="background:${accent};padding:18px 24px;color:#ffffff;font:600 17px/1.3 Arial,Helvetica,sans-serif;text-align:${align}">${brand}</td></tr>` : "",
    `<tr><td dir="${dir}" style="padding:24px;color:#1d2433;font:15px/1.6 Arial,Helvetica,sans-serif;text-align:${align}">${paragraphs}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}
