import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendEmail, type EmailResult } from "./send";

/**
 * Wave 61 — platform emails that always arrive.
 *
 * The platform's email service (Resend) only delivers to everyone once its sender domain is verified. Until then
 * (or whenever it fails) the email goes out from the platform owner's own connected mailbox (Gmail / Outlook,
 * already connected under Integrations → Email) — zero extra setup. Optional env PLATFORM_MAILBOX_ORG_ID picks
 * which business's mailbox sends; by default the first mailbox of a platform admin's business is used.
 * Used for account emails (verify email, reset password) and team invitations. Never throws.
 */
async function platformMailboxOrg(): Promise<string | null> {
  const fixed = (process.env.PLATFORM_MAILBOX_ORG_ID ?? "").trim();
  if (/^[0-9a-f-]{36}$/i.test(fixed)) return fixed;
  const admin = createAdminClient();
  const { data: admins } = await admin.from("platform_admins").select("user_id").limit(20);
  const ids = ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id);
  if (!ids.length) return null;
  const { data: orgs } = await admin.from("organization_members").select("organization_id").in("user_id", ids).limit(50);
  const orgIds = [...new Set(((orgs ?? []) as { organization_id: string }[]).map((o) => o.organization_id))];
  if (!orgIds.length) return null;
  const { data: box } = await admin.from("channel_accounts").select("organization_id").eq("kind", "email").neq("status", "disabled").in("organization_id", orgIds).order("created_at").limit(1).maybeSingle();
  return (box?.organization_id as string | undefined) ?? null;
}

export async function sendViaPlatformMailbox(input: { to: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const org = await platformMailboxOrg();
    if (!org) return { ok: false, error: "no_platform_mailbox" };
    const { loadAccount } = await import("@/lib/channels/accounts");
    const box = await loadAccount(org, "email");
    if (!box) return { ok: false, error: "no_platform_mailbox" };
    const { sendMailboxEmail } = await import("@/lib/channels/email");
    const r = await sendMailboxEmail(box, input.to, input.subject, input.text, input.html);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Resend first; when it cannot deliver, the platform owner's connected mailbox (sendEmail does the fallback). */
export async function sendPlatformEmail(input: { to: string; subject: string; html: string; text: string }): Promise<EmailResult> {
  const r = await sendEmail(input);
  if (!r.sent) console.error("platform email failed", r.reason);
  return r;
}

/** The fallback used by sendEmail: the business's own mailbox (orgId) or, for platform emails, the owner's. */
export async function sendViaMailboxFallback(input: { to: string; subject: string; html: string; text: string }, orgId: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!orgId) return sendViaPlatformMailbox(input);
  try {
    const { loadAccount } = await import("@/lib/channels/accounts");
    const box = await loadAccount(orgId, "email");
    if (!box || box.status === "disabled") return { ok: false, error: "no_mailbox" };
    const { sendMailboxEmail } = await import("@/lib/channels/email");
    const r = await sendMailboxEmail(box, input.to, input.subject, input.text, input.html);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Verify your email" / "Reset your password" — the platform's own branded account emails. */
export function accountEmail(kind: "verify" | "reset", locale: "he" | "en" | "ar", link: string, name?: string | null) {
  const T = {
    he: {
      verify: { subject: "אימות כתובת המייל — Super Coder Cloud", title: `${name ? `${name}, ` : ""}ברוכים הבאים!`, body: "נשאר רק לאמת את כתובת המייל כדי להפעיל את החשבון.", cta: "אימות המייל", note: "אם לא נרשמת, אפשר להתעלם מהמייל הזה." },
      reset: { subject: "איפוס סיסמה — Super Coder Cloud", title: "איפוס סיסמה", body: "קיבלנו בקשה לאפס את הסיסמה לחשבון שלך. לחצו על הכפתור ובחרו סיסמה חדשה.", cta: "בחירת סיסמה חדשה", note: "הקישור תקף לזמן קצר. אם לא ביקשת, אפשר להתעלם." },
    },
    en: {
      verify: { subject: "Verify your email — Super Coder Cloud", title: `Welcome${name ? `, ${name}` : ""}!`, body: "One last step: verify your email address to activate your account.", cta: "Verify email", note: "If you did not sign up, you can ignore this email." },
      reset: { subject: "Reset your password — Super Coder Cloud", title: "Reset your password", body: "We received a request to reset your password. Click the button and choose a new one.", cta: "Choose a new password", note: "The link is valid for a short time. If you did not ask, ignore this email." },
    },
    ar: {
      verify: { subject: "تأكيد البريد الإلكتروني — Super Coder Cloud", title: `أهلًا بك${name ? ` ${name}` : ""}!`, body: "خطوة أخيرة: أكّد بريدك الإلكتروني لتفعيل حسابك.", cta: "تأكيد البريد", note: "إذا لم تقم بالتسجيل، تجاهل هذه الرسالة." },
      reset: { subject: "إعادة تعيين كلمة المرور — Super Coder Cloud", title: "إعادة تعيين كلمة المرور", body: "تلقينا طلبًا لإعادة تعيين كلمة المرور. انقر على الزر واختر كلمة جديدة.", cta: "اختيار كلمة مرور جديدة", note: "الرابط صالح لفترة قصيرة. إذا لم تطلب ذلك، تجاهل الرسالة." },
    },
  }[locale][kind];
  const dir = locale === "en" ? "ltr" : "rtl";
  const safe = escapeHtml(link);
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#080D19;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#F8FAFC">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="background:#111A2B;border:1px solid #24324D;border-radius:16px;padding:28px">
<div style="font-size:13px;letter-spacing:.18em;color:#C9A66B;font-weight:600" dir="ltr">SUPER CODER CLOUD</div>
<h1 style="font-size:22px;margin:14px 0 8px">${escapeHtml(T.title)}</h1>
<p style="color:#9CAFC7;line-height:1.6;margin:0 0 22px">${escapeHtml(T.body)}</p>
<a href="${safe}" style="display:inline-block;background:#3366E6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600">${escapeHtml(T.cta)}</a>
<p style="color:#6F84A3;font-size:12px;margin:22px 0 0">${escapeHtml(T.note)}</p>
<p style="color:#6F84A3;font-size:11px;margin:12px 0 0;word-break:break-all" dir="ltr">${safe}</p>
</div></div></body></html>`;
  return { subject: T.subject, html, text: `${T.title}\n\n${T.body}\n\n${link}\n\n${T.note}` };
}
