"use server";

import { redirect } from "next/navigation";
import { emailOnlySchema, fieldErrors, newPasswordSchema, signInSchema, signUpSchema } from "@scc/shared/validators";
import { createClient } from "@/lib/supabase/server";
import { publicEnv, safeRedirectPath } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { formValues, type ActionState } from "@/lib/action-state";

function localeFrom(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

function authErrorKey(err: { message?: string; status?: number; code?: string }): string {
  if (err.status === 429 || err.code === "over_request_rate_limit") return "auth.rateLimited";
  if (err.code === "email_not_confirmed" || /not confirmed/i.test(err.message ?? "")) return "auth.emailNotConfirmed";
  if (err.code === "invalid_credentials" || /invalid login/i.test(err.message ?? "")) return "auth.invalidCredentials";
  return "auth.genericError";
}

export async function signInAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = localeFrom(fd);
  const parsed = signInSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  const values = formValues(fd, ["email"]);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authErrorKey(error), values };

  const next = safeRedirectPath(fd.get("next") as string | null, `/${locale}/overview`);
  redirect(next);
}

export async function signUpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = localeFrom(fd);
  const values = formValues(fd, ["email", "fullName"]);
  const parsed = signUpSchema.safeParse({
    fullName: fd.get("fullName"),
    email: fd.get("email"),
    password: fd.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  // wave 61: the platform sends its own branded verification email (Resend, else the owner's connected mailbox),
  // so every new user gets it even before a custom SMTP / verified domain exists. Any problem → the original flow below.
  const own = await platformSignUp(locale, parsed.data).catch(() => null);
  if (own === "session") redirect(`/${locale}/onboarding`);
  if (own === "sent") return { ok: true, message: "auth.checkEmailBody", messageParams: { email: parsed.data.email } };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/onboarding`,
      data: { full_name: parsed.data.fullName, locale },
    },
  });
  if (error) return { error: authErrorKey(error), values };

  // When email confirmation is disabled in Supabase, a session is returned immediately.
  if (data.session) redirect(`/${locale}/onboarding`);
  return { ok: true, message: "auth.checkEmailBody", messageParams: { email: parsed.data.email } };
}

export async function forgotPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = localeFrom(fd);
  const parsed = emailOnlySchema.safeParse({ email: fd.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(fd, ["email"]) };
  // wave 61: the platform's own reset email first (always delivered); identical answer either way
  if (await platformRecovery(locale, parsed.data.email).catch(() => false)) return { ok: true, message: "auth.resetSent" };
  const supabase = await createClient();
  // Response is identical whether or not the account exists (no user enumeration).
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/reset-password`,
  });
  return { ok: true, message: "auth.resetSent" };
}

export async function updatePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = localeFrom(fd);
  const parsed = newPasswordSchema.safeParse({ password: fd.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: authErrorKey(error) };
  redirect(`/${locale}/overview`);
}

export async function signInWithGoogleAction(fd: FormData) {
  const locale = localeFrom(fd);
  if (!publicEnv.googleAuthEnabled) redirect(`/${locale}/login`);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/overview` },
  });
  if (error || !data.url) redirect(`/${locale}/login?error=oauth`);
  redirect(data.url);
}

export async function signOutAction(fd: FormData) {
  const locale = localeFrom(fd);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}

/* ------------------------------------------------------------------ wave 61 — account emails that always arrive */

/** Creates the account with a verification link and emails it ourselves. "sent" | "session" | null (= use the original flow). */
// Opt-in only (PLATFORM_ACCOUNT_EMAILS=on): when Supabase already delivers its own verification / reset emails,
// nothing changes — the original flow stays exactly as it is.
const platformAccountEmails = () => (process.env.PLATFORM_ACCOUNT_EMAILS ?? "").toLowerCase() === "on";

async function platformSignUp(locale: Locale, d: { fullName: string; email: string; password: string }): Promise<"sent" | "session" | null> {
  if (!platformAccountEmails() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: d.email,
    password: d.password,
    options: { data: { full_name: d.fullName, locale }, redirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/onboarding` },
  });
  // existing address, rate limit … → the original flow keeps its exact behaviour (no user enumeration)
  if (error || !data?.properties?.hashed_token) return null;
  // email confirmation switched off in Supabase → sign in right away, as before
  if (data.user?.email_confirmed_at) {
    const supabase = await createClient();
    const { error: e2 } = await supabase.auth.signInWithPassword({ email: d.email, password: d.password });
    return e2 ? null : "session";
  }
  const link = `${publicEnv.appUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=signup&next=/${locale}/onboarding`;
  const { accountEmail, sendPlatformEmail } = await import("@/lib/email/platform");
  const mail = accountEmail("verify", locale, link, d.fullName);
  const r = await sendPlatformEmail({ to: d.email, ...mail });
  if (r.sent) return "sent";
  // nothing could deliver it: let Supabase try its own mailer for the user that now exists
  const supabase = await createClient();
  await supabase.auth.resend({ type: "signup", email: d.email, options: { emailRedirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/onboarding` } }).catch(() => undefined);
  return "sent";
}

/** Password reset link emailed by the platform. true = handled (whether or not the account exists). */
async function platformRecovery(locale: Locale, email: string): Promise<boolean> {
  if (!platformAccountEmails() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${publicEnv.appUrl}/auth/confirm?next=/${locale}/reset-password` } });
  if (error || !data?.properties?.hashed_token) return /not.?found|no user/i.test(error?.message ?? "") ? true : false;
  const link = `${publicEnv.appUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/${locale}/reset-password`;
  const { accountEmail, sendPlatformEmail } = await import("@/lib/email/platform");
  return (await sendPlatformEmail({ to: email, ...accountEmail("reset", locale, link) })).sent;
}
