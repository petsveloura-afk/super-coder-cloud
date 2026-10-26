"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Field, Input } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/auth/password-field";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { initialState } from "@/lib/action-state";
import {
  forgotPasswordAction,
  signInAction,
  signInWithGoogleAction,
  signUpAction,
  updatePasswordAction,
} from "@/app/[locale]/(auth)/actions";

function Hidden({ locale, next }: { locale: string; next?: string }) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
    </>
  );
}

export function GoogleButton() {
  const { t, locale } = useI18n();
  return (
    <form action={signInWithGoogleAction}>
      <Hidden locale={locale} />
      <SubmitButton variant="secondary" className="w-full justify-center">
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4-5.5 4-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        {t("auth.google")}
      </SubmitButton>
    </form>
  );
}

export function SignInForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(signInAction, initialState);
  const err = useFieldError(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Hidden locale={locale} next={next} />
      {linkError && !state.error ? <FormAlert state={{ error: "auth.linkExpired" }} /> : <FormAlert state={state} />}
      <Field label={t("auth.email")} htmlFor="email" error={err("email")}>
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" inputMode="email" required
          defaultValue={state.values?.email} aria-invalid={Boolean(err("email"))} />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" error={err("password")}>
        <PasswordInput id="password" name="password" autoComplete="current-password" required
          aria-invalid={Boolean(err("password"))} />
      </Field>
      <div className="flex justify-end">
        <Link href={`/${locale}/forgot-password`} className="text-[13px] text-accent hover:underline">
          {t("auth.forgotPassword")}
        </Link>
      </div>
      <SubmitButton size="lg" className="w-full justify-center">{t("auth.signIn")}</SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(signUpAction, initialState);
  const err = useFieldError(state);
  if (state.ok) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-lg font-semibold">{t("auth.checkEmail")}</h2>
        <FormAlert state={state} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <Hidden locale={locale} />
      <FormAlert state={state} />
      <Field label={t("auth.fullName")} htmlFor="fullName" error={err("fullName")}>
        <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName}
          aria-invalid={Boolean(err("fullName"))} />
      </Field>
      <Field label={t("auth.email")} htmlFor="email" error={err("email")}>
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" inputMode="email" required
          defaultValue={state.values?.email} aria-invalid={Boolean(err("email"))} />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" error={err("password")} hint={t("auth.passwordHint")}>
        <PasswordInput meter id="password" name="password" autoComplete="new-password" required minLength={10}
          aria-invalid={Boolean(err("password"))} />
      </Field>
      <SubmitButton size="lg" className="w-full justify-center">{t("auth.signUp")}</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(forgotPasswordAction, initialState);
  const err = useFieldError(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Hidden locale={locale} />
      <FormAlert state={state} />
      <Field label={t("auth.email")} htmlFor="email" error={err("email")}>
        <Input id="email" name="email" type="email" dir="ltr" autoComplete="email" required defaultValue={state.values?.email}
          aria-invalid={Boolean(err("email"))} />
      </Field>
      <SubmitButton size="lg" className="w-full justify-center">{t("auth.sendReset")}</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(updatePasswordAction, initialState);
  const err = useFieldError(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Hidden locale={locale} />
      <FormAlert state={state} />
      <Field label={t("auth.newPassword")} htmlFor="password" error={err("password")} hint={t("auth.passwordHint")}>
        <PasswordInput meter id="password" name="password" autoComplete="new-password" required minLength={10}
          aria-invalid={Boolean(err("password"))} />
      </Field>
      <SubmitButton size="lg" className="w-full justify-center">{t("auth.updatePassword")}</SubmitButton>
    </form>
  );
}
