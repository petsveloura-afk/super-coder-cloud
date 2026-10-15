"use client";

import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

/**
 * Accessible dialog (focus trap, Esc to close, aria-labelledby) built on Radix.
 * On phones it becomes a bottom sheet with safe-area padding.
 */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const { t, dir } = useI18n();
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RD.Trigger asChild>{trigger}</RD.Trigger> : null}
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RD.Content
          dir={dir}
          className={cn(
            "fixed z-50 w-full border border-line bg-elevated shadow-2xl focus:outline-none",
            "bottom-0 start-0 max-h-[92dvh] overflow-y-auto rounded-t-3xl pb-safe",
            "sm:bottom-auto sm:start-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0 ltr:sm:-translate-x-1/2 rtl:sm:translate-x-1/2",
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4 sm:px-6 sm:pt-5">
            <div>
              <RD.Title className="text-lg font-semibold text-fg">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-sm text-muted">{description}</RD.Description> : null}
            </div>
            <RD.Close className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-fg" aria-label={t("common.close")}>
              <X className="h-5 w-5" />
            </RD.Close>
          </div>
          {!description ? <RD.Description className="sr-only">{title}</RD.Description> : null}
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
