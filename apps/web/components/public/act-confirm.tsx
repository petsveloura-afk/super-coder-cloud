"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { performActAction } from "@/app/[locale]/(public)/actions";

/** Wave 15 — the button that runs a signed reminder action. */
export function ActConfirm({ token, label, danger }: { token: string; label: string; danger?: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState<{ message: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <p className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-success" role="status" data-testid="act-done">
        <CheckCircle2 className="h-5 w-5" /> {t(done.message, { title: done.title })}
      </p>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      <Button
        size="lg"
        variant={danger ? "danger" : "primary"}
        loading={pending}
        className="w-full justify-center"
        data-testid="act-run"
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await performActAction({ token });
            if (r.ok) setDone({ message: r.message ?? "common.saved", title: String(r.data?.title ?? "") });
            else setError(r.error ?? "errors.generic");
          })
        }
      >
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
