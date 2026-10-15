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
