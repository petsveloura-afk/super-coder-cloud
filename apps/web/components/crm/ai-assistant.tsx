"use client";

import { useActionState, useState } from "react";
import { Copy, NotebookPen, Sparkles, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import { aiContactAction } from "@/app/[locale]/(dashboard)/crm/ai-actions";
import { addNoteAction } from "@/app/[locale]/(dashboard)/crm/actions";
import type { ActionState } from "@/lib/action-state";

export function ContactAIAssistant({ contactId, canWriteNotes }: { contactId: string; canWriteNotes: boolean }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(aiContactAction, {} as ActionState<{ text: string }>);
  const [noteState, noteAction] = useActionState(addNoteAction, {} as ActionState);
  const [copied, setCopied] = useState(false);
  const text = state.ok ? state.data?.text : undefined;

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="contactId" value={contactId} />
        <SubmitButton name="kind" value="summary" variant="secondary" size="sm">
          <Sparkles className="h-4 w-4 text-gold" /> {t("ai.summarize")}
        </SubmitButton>
        <SubmitButton name="kind" value="followup" variant="secondary" size="sm">
          <Wand2 className="h-4 w-4 text-teal" /> {t("ai.followup")}
        </SubmitButton>
      </form>
      {state.error ? <FormAlert state={state} /> : null}
      {text ? (
        <div className="rounded-xl border border-gold/30 bg-gold-soft/40 p-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-gold">
            <Sparkles className="h-3.5 w-3.5" /> {t("ai.aiNotice")}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              }}
            >
              <Copy className="h-4 w-4" /> {copied ? t("common.copied") : t("common.copy")}
            </Button>
            {canWriteNotes ? (
              <form action={noteAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="contactId" value={contactId} />
                <input type="hidden" name="body" value={`[AI] ${text}`.slice(0, 10000)} />
                <SubmitButton size="sm" variant="ghost">
                  <NotebookPen className="h-4 w-4" /> {noteState.ok ? t("crm.noteAdded") : t("ai.saveAsNote")}
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
