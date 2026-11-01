"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Copy, LifeBuoy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { eventId } from "@/lib/ops/log-core";

/**
 * Loading skeletons and error screens for every module (spec B2). The error screen reports the crash once
 * (/api/errors → Mission Control), shows an event id the user can quote, and offers retry / copy / support.
 */
export function ModuleSkeleton({ variant = "list" }: { variant?: "list" | "board" | "grid" | "detail" | "chat" }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-5" data-testid="module-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {variant === "board" ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} className="h-16 w-full" />
              ))}
            </Card>
          ))}
        </div>
      ) : variant === "grid" ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
            </Card>
          ))}
        </div>
      ) : variant === "chat" ? (
        <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
          <Card className="space-y-3 p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </Card>
          <Card className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className={i % 2 ? "ms-auto h-10 w-1/2" : "h-10 w-2/3"} />
            ))}
          </Card>
        </div>
      ) : variant === "detail" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="space-y-3 p-5 lg:col-span-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-40 w-full" />
          </Card>
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full" />
          </Card>
        </div>
      ) : (
        <Card className="divide-y divide-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export function ModuleError({ error, reset, module }: { error: Error & { digest?: string }; reset: () => void; module?: string }) {
  const { t, locale } = useI18n();
  const id = useMemo(() => eventId(error.digest), [error.digest]);
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `${module ? `[${module}] ` : ""}${error.message || "error"}`.slice(0, 1000), route: typeof window !== "undefined" ? window.location.pathname : undefined, digest: error.digest ?? id }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error, id, module]);
  return (
    <Card className="mx-auto max-w-xl p-6 text-center" role="alert" data-testid="module-error">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft">
        <AlertTriangle className="h-6 w-6 text-danger" />
      </div>
      <h2 className="mt-3 text-lg font-semibold">{t("ops.errorTitle")}</h2>
      <p className="mt-1 text-[13.5px] text-muted">{t("ops.errorBody")}</p>
      <p className="mt-3 text-[12px] text-subtle">
        {t("ops.eventId")}: <bdi dir="ltr" className="font-mono">{id}</bdi>
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" /> {t("common.retry")}
        </Button>
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(id).then(() => toast.success(t("ops.copied")))}>
          <Copy className="h-4 w-4" /> {t("ops.copyId")}
        </Button>
        <a href={`/${locale}/support`} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-accent hover:bg-surface-hover">
          <LifeBuoy className="h-4 w-4" /> {t("ops.report")}
        </a>
      </div>
    </Card>
  );
}
