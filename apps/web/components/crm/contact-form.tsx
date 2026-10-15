"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { CONTACT_STATUSES, LEAD_SOURCES } from "@scc/shared/validators";
import type { ContactRow } from "@scc/database";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { createContactAction, updateContactAction } from "@/app/[locale]/(dashboard)/crm/actions";
import type { ActionState } from "@/lib/action-state";

function ContactFields({ state, contact, isEdit }: { state: ActionState<unknown>; contact?: ContactRow; isEdit: boolean }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const v = (name: string, fallback?: string | null) => state.values?.[name] ?? fallback ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("crm.firstName")} htmlFor="firstName" error={err("firstName")}>
        <Input id="firstName" name="firstName" required autoComplete="off" defaultValue={v("firstName", contact?.first_name)} aria-invalid={Boolean(err("firstName"))} />
      </Field>
      <Field label={t("crm.lastName")} htmlFor="lastName" error={err("lastName")}>
        <Input id="lastName" name="lastName" autoComplete="off" defaultValue={v("lastName", contact?.last_name)} />
      </Field>
      <Field label={t("crm.email")} htmlFor="email" error={err("email")}>
        <Input id="email" name="email" type="email" dir="ltr" inputMode="email" autoComplete="off" defaultValue={v("email", contact?.email)} aria-invalid={Boolean(err("email"))} />
      </Field>
      <Field label={t("crm.phone")} htmlFor="phone" error={err("phone")}>
        <Input id="phone" name="phone" type="tel" dir="ltr" inputMode="tel" autoComplete="off" placeholder="+972501234567" defaultValue={v("phone", contact?.phone)} aria-invalid={Boolean(err("phone"))} />
      </Field>
      <Field label={t("crm.company")} htmlFor="companyName" error={err("companyName")}>
        <Input id="companyName" name="companyName" defaultValue={v("companyName", contact?.company_name)} />
      </Field>
      <Field label={t("crm.jobTitle")} htmlFor="jobTitle" error={err("jobTitle")}>
        <Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle", contact?.job_title)} />
      </Field>
      <Field label={t("crm.status")} htmlFor="status">
        <Select id="status" name="status" defaultValue={v("status", contact?.status ?? "lead")}>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`crm.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("crm.source")} htmlFor="source">
        <Select id="source" name="source" defaultValue={v("source", contact?.source ?? "manual")}>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`crm.sources.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      {!isEdit ? (
        <Field label={t("crm.notes")} htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={v("notes")} />
        </Field>
      ) : null}
      <label className="flex items-center gap-2.5 text-sm text-muted sm:col-span-2">
        <input type="checkbox" name="marketingConsent" defaultChecked={contact?.marketing_consent ?? false} className="h-4 w-4 accent-[var(--accent)]" />
        {t("crm.consent")}
      </label>
    </div>
  );
}

export function ContactDialog({ contact, defaultOpen }: { contact?: ContactRow; defaultOpen?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const isEdit = Boolean(contact);
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [formKey, setFormKey] = useState(0);
  const [state, action] = useActionState(isEdit ? updateContactAction : createContactAction, {});
  const handled = useRef<ActionState<unknown> | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success(t(state.message ?? "common.saved"));
      setOpen(false);
      setFormKey((k) => k + 1);
      if (!isEdit && state.data?.id) router.push(`/${locale}/crm/${state.data.id}`);
      else router.refresh();
    }
  }, [state, isEdit, locale, router, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t(isEdit ? "crm.editContact" : "crm.newContact")}
      className="sm:max-w-2xl"
      trigger={
        isEdit ? (
          <Button variant="secondary">
            <Pencil className="h-4 w-4" /> {t("common.edit")}
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> {t("crm.newContact")}
          </Button>
        )
      }
    >
      <form key={formKey} action={action} className="space-y-5" noValidate>
        <input type="hidden" name="locale" value={locale} />
        {contact ? <input type="hidden" name="id" value={contact.id} /> : null}
        <FormAlert state={state.ok ? {} : state} />
        <ContactFields state={state.ok ? {} : state} contact={contact} isEdit={isEdit} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <SubmitButton>{t(isEdit ? "common.save" : "common.create")}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
