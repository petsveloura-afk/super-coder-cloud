"use client";

import { useActionState, useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Textarea } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { addNoteAction, deleteContactAction } from "@/app/[locale]/(dashboard)/crm/actions";
import type { ActionState } from "@/lib/action-state";

export function DeleteContactButton({ id }: { id: string }) {
  const { t, locale } = useI18n();
  return (
    <form
      action={deleteContactAction}
      onSubmit={(e) => {
        if (!window.confirm(t("common.confirmDelete"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger">
        <Trash2 className="h-4 w-4" /> {t("common.delete")}
      </Button>
    </form>
  );
}

export function AddNoteForm({ contactId }: { contactId: string }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(addNoteAction, {} as ActionState);
  const err = useFieldError(state);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && seen.current !== state) {
      seen.current = state;
      formRef.current?.reset();
      toast.success(t("crm.noteAdded"));
    }
  }, [state, t]);
  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="contactId" value={contactId} />
      {state.error ? <FormAlert state={state} /> : null}
      <Textarea name="body" placeholder={t("crm.notePlaceholder")} aria-label={t("crm.addNote")} aria-invalid={Boolean(err("body"))} />
      {err("body") ? <p className="text-[13px] text-danger">{err("body")}</p> : null}
      <div className="flex justify-end">
        <SubmitButton size="sm">{t("crm.addNote")}</SubmitButton>
      </div>
    </form>
  );
}
