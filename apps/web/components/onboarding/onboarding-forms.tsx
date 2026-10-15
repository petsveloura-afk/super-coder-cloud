"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { initialState } from "@/lib/action-state";
import { acceptInvitationAction, createOrganizationAction } from "@/app/[locale]/(onboarding)/onboarding/actions";

function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateOrgForm() {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(createOrganizationAction, initialState);
  const err = useFieldError(state);
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [touched, setTouched] = useState(false);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <FormAlert state={state} />
      <Field label={t("onboarding.orgName")} htmlFor="name" error={err("name")}>
        <Input
          id="name"
          name="name"
          required
          defaultValue={state.values?.name}
          aria-invalid={Boolean(err("name"))}
          onChange={(e) => {
            if (!touched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label={t("onboarding.orgSlug")} htmlFor="slug" error={err("slug")} hint={t("onboarding.slugHint")}>
        <Input
          id="slug"
          name="slug"
          dir="ltr"
          required
          value={slug}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          aria-invalid={Boolean(err("slug"))}
        />
      </Field>
      <Field label={t("onboarding.currency")} htmlFor="currency">
        <Select id="currency" name="currency" defaultValue={state.values?.currency ?? "ILS"} dir="ltr">
          <option value="ILS">ILS ₪</option>
          <option value="USD">USD $</option>
          <option value="EUR">EUR €</option>
          <option value="GBP">GBP £</option>
          <option value="AED">AED</option>
        </Select>
      </Field>
      <SubmitButton size="lg" className="w-full justify-center">{t("onboarding.create")}</SubmitButton>
    </form>
  );
}

export function JoinOrgForm({ defaultToken }: { defaultToken?: string }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(acceptInvitationAction, initialState);
  const err = useFieldError(state);
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <Field label={t("onboarding.inviteToken")} htmlFor="token" error={err("token")}>
        <Input id="token" name="token" dir="ltr" defaultValue={defaultToken} autoComplete="off" spellCheck={false} aria-invalid={Boolean(err("token"))} />
      </Field>
      <SubmitButton variant="secondary" className="w-full justify-center">{t("onboarding.join")}</SubmitButton>
    </form>
  );
}
