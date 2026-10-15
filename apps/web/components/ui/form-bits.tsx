"use client";

import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, type ButtonProps } from "./primitives";
import { useI18n } from "@/lib/i18n/client";
import type { ActionState } from "@/lib/action-state";

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

export function FormAlert({ state }: { state: ActionState<unknown> }) {
  const { t } = useI18n();
  if (state.error) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t(state.error)}</span>
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t(state.message, state.messageParams)}</span>
      </div>
    );
  }
  return null;
}

/** Translates a field error key from an ActionState. */
export function useFieldError(state: ActionState<unknown>) {
  const { t } = useI18n();
  return (name: string) => (state.fieldErrors?.[name] ? t(state.fieldErrors[name]!) : undefined);
}
