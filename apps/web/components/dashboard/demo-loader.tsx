"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import { initialState } from "@/lib/action-state";
import { loadDemoDataAction } from "@/app/[locale]/(dashboard)/overview/actions";

export function DemoLoader() {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(loadDemoDataAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <FormAlert state={state} />
      {!state.ok ? (
        <SubmitButton variant="outline">
          <Sparkles className="h-4 w-4 text-gold" />
          {t("dashboard.loadDemo")}
        </SubmitButton>
      ) : null}
    </form>
  );
}
