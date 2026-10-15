"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { updateOrganizationAction, updateProfileAction } from "@/app/[locale]/(dashboard)/settings/actions";
import type { ActionState } from "@/lib/action-state";

const COMMON_TZ = ["Asia/Jerusalem", "Asia/Dubai", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];

export function OrgSettingsForm({
  org,
  readOnly,
}: {
  org: { name: string; timezone: string; currency: string; locale: string };
  readOnly: boolean;
}) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(updateOrganizationAction, {} as ActionState);
  const err = useFieldError(state);
  const tzs = COMMON_TZ.includes(org.timezone) ? COMMON_TZ : [org.timezone, ...COMMON_TZ];
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormAlert state={state} />
      {readOnly ? <p className="rounded-xl bg-elevated px-3.5 py-2.5 text-sm text-muted">{t("settings.readOnlyNotice")}</p> : null}
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("settings.name")} htmlFor="org-name" error={err("name")} className="sm:col-span-2">
          <Input id="org-name" name="name" defaultValue={state.values?.name ?? org.name} aria-invalid={Boolean(err("name"))} />
        </Field>
        <Field label={t("settings.timezone")} htmlFor="org-tz" error={err("timezone")}>
          <Select id="org-tz" name="timezone" defaultValue={org.timezone} dir="ltr">
            {tzs.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.currency")} htmlFor="org-currency">
          <Select id="org-currency" name="currency" defaultValue={org.currency} dir="ltr">
            {["ILS", "USD", "EUR", "GBP", "AED"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.locale")} htmlFor="org-locale">
          <Select id="org-locale" name="defaultLocale" defaultValue={org.locale}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>{LOCALE_META[l].label}</option>
            ))}
          </Select>
        </Field>
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

export function ProfileForm({ fullName, preferredLocale }: { fullName: string; preferredLocale: string }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(updateProfileAction, {} as ActionState);
  const err = useFieldError(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormAlert state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.fullName")} htmlFor="p-name" error={err("fullName")}>
          <Input id="p-name" name="fullName" defaultValue={fullName} aria-invalid={Boolean(err("fullName"))} />
        </Field>
        <Field label={t("common.language")} htmlFor="p-locale">
          <Select id="p-locale" name="preferredLocale" defaultValue={preferredLocale}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>{LOCALE_META[l].label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
