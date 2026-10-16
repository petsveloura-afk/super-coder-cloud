"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/primitives";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/action-state";

type FormAction<T> = (prev: ActionState<T>, fd: FormData) => Promise<ActionState<T>>;

/**
 * Generic dialog + form bound to a server action (useActionState).
 * - Keeps typed values after a failed submit (fields read `state.values`).
 * - On success: toast, close, reset, then `redirectTo(data)` or router.refresh().
 * - `hidden` adds hidden inputs (ids, locale is always added).
 */
export function FormDialog<T = undefined>({
  action,
  title,
  description,
  trigger,
  submitLabel,
  hidden,
  children,
  redirectTo,
  defaultOpen,
  className,
  footer,
}: {
  action: FormAction<T>;
  title: string;
  description?: string;
  trigger: ReactNode;
  submitLabel?: string;
  hidden?: Record<string, string | undefined | null>;
  children: (state: ActionState<T>) => ReactNode;
  redirectTo?: (data: T | undefined) => string | null | undefined;
  defaultOpen?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useActionState(action, {} as ActionState<T>);
  const handled = useRef<ActionState<T> | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success(t(state.message ?? "common.saved", state.messageParams));
      setOpen(false);
      setFormKey((k) => k + 1);
      const to = redirectTo?.(state.data);
      if (to) router.push(to);
      else router.refresh();
    }
  }, [state, router, t, redirectTo]);

  const shown = state.ok ? ({} as ActionState<T>) : state;
  return (
    <Dialog open={open} onOpenChange={setOpen} title={title} description={description} trigger={trigger} className={className ?? "sm:max-w-xl"}>
      <form key={formKey} action={formAction} className="space-y-5" noValidate>
        <input type="hidden" name="locale" value={locale} />
        {Object.entries(hidden ?? {}).map(([k, v]) => (v != null ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <FormAlert state={shown} />
        {children(shown)}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <SubmitButton>{submitLabel ?? t("common.save")}</SubmitButton>
        </div>
      </form>
      {/* Secondary actions are separate forms, so they live outside the main form (no nested forms). */}
      {footer ? <div className="mt-5 border-t border-line pt-4">{footer}</div> : null}
    </Dialog>
  );
}

/** Confirming submit button bound to a (FormData) => Promise<void|ActionState> server action. */
export function ConfirmActionButton({
  action,
  fields,
  label,
  confirm,
  variant = "danger",
  size,
  icon,
  className,
  redirectTo,
}: {
  redirectTo?: string;
  action: (fd: FormData) => Promise<unknown>;
  fields: Record<string, string>;
  label?: string;
  confirm?: string | false;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: ReactNode;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <form
      className={className}
      action={async (fd) => {
        setPending(true);
        try {
          const res = (await action(fd)) as ActionState<unknown> | undefined;
          if (res && typeof res === "object" && "error" in res && res.error) toast.error(t(res.error));
          else if (res && typeof res === "object" && res.ok) {
            if (res.message) toast.success(t(res.message));
            if (redirectTo) {
              router.push(redirectTo);
              return;
            }
          }
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
      onSubmit={(e) => {
        if (confirm !== false && !window.confirm(confirm ?? t("common.confirmDelete"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} size={size} loading={pending}>
        {icon ?? (variant === "danger" ? <Trash2 className="h-4 w-4" /> : null)}
        {label ?? t("common.delete")}
      </Button>
    </form>
  );
}
