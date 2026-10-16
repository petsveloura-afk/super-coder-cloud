import "server-only";

/**
 * Transactional email (Resend REST API, no SDK).
 * Enabled when EMAIL_PROVIDER_API_KEY + EMAIL_FROM_ADDRESS are set; otherwise
 * every send is a no-op that returns { sent: false, reason: "not_configured" }
 * so the product keeps working (e.g. invitation links are still shown once).
 * The same Resend key can be used as SMTP in Supabase Auth for signup emails.
 */
export interface EmailResult {
  sent: boolean;
  reason?: "not_configured" | "provider_error";
}

export function emailConfigured(): boolean {
  return Boolean(process.env.EMAIL_PROVIDER_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendEmail(input: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<EmailResult> {
  if (!emailConfigured()) return { sent: false, reason: "not_configured" };
  const base = (process.env.EMAIL_PROVIDER_API_BASE || "https://api.resend.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_ADDRESS,
        to: [input.to],
        subject: input.subject.slice(0, 200),
        html: input.html,
        text: input.text,
        ...(input.headers ? { headers: input.headers } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("email provider error", res.status);
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("email send failed", (err as Error).message);
    return { sent: false, reason: "provider_error" };
  }
}

/** Invitation email in the inviter's language (RTL for he/ar). All dynamic values are HTML-escaped. */
export function invitationEmail(opts: {
  locale: "he" | "ar" | "en";
  orgName: string;
  inviterName: string;
  roleLabel: string;
  link: string;
}) {
  const T = {
    he: {
      subject: `הוזמנת להצטרף ל-${opts.orgName} ב-Super Coder Cloud`,
      title: "קיבלת הזמנה",
      body: `${opts.inviterName} הזמין/ה אותך להצטרף לסביבת העבודה "${opts.orgName}" בתפקיד ${opts.roleLabel}.`,
      cta: "הצטרפות",
      note: "הקישור תקף ל-7 ימים ומיועד לכתובת המייל הזו בלבד.",
    },
    ar: {
      subject: `تمت دعوتك للانضمام إلى ${opts.orgName} في Super Coder Cloud`,
      title: "لديك دعوة",
      body: `دعاك ${opts.inviterName} للانضمام إلى مساحة العمل "${opts.orgName}" بدور ${opts.roleLabel}.`,
      cta: "انضمام",
      note: "الرابط صالح لمدة 7 أيام ولهذا البريد فقط.",
    },
    en: {
      subject: `You're invited to join ${opts.orgName} on Super Coder Cloud`,
      title: "You have an invitation",
      body: `${opts.inviterName} invited you to join the "${opts.orgName}" workspace as ${opts.roleLabel}.`,
      cta: "Join",
      note: "This link is valid for 7 days and only for this email address.",
    },
  }[opts.locale];
  const dir = opts.locale === "en" ? "ltr" : "rtl";
  const safeLink = escapeHtml(opts.link);
  const html = `<!doctype html><html lang="${opts.locale}" dir="${dir}"><body style="margin:0;background:#080D19;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#F8FAFC">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="background:#111A2B;border:1px solid #24324D;border-radius:16px;padding:28px">
<div style="font-size:13px;letter-spacing:.18em;color:#C9A66B;font-weight:600" dir="ltr">SUPER CODER CLOUD</div>
<h1 style="font-size:22px;margin:14px 0 8px">${escapeHtml(T.title)}</h1>
<p style="color:#9CAFC7;line-height:1.6;margin:0 0 22px">${escapeHtml(T.body)}</p>
<a href="${safeLink}" style="display:inline-block;background:#3366E6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600">${escapeHtml(T.cta)}</a>
<p style="color:#6F84A3;font-size:12px;margin:22px 0 0">${escapeHtml(T.note)}</p>
</div></div></body></html>`;
  const text = `${T.title}\n\n${T.body}\n\n${opts.link}\n\n${T.note}`;
  return { subject: T.subject, html, text };
}
