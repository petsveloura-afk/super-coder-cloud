"use client";

import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { unfilledPlaceholders } from "@/lib/campaigns/templates";

/** the warning above the send buttons: [placeholders] from a playbook / the AI that were not filled yet */
export function PlaceholderWarning({ subject, body }: { subject: string; body: string }) {
  const { t } = useI18n();
  const left = unfilledPlaceholders(subject, body);
  if (!left.length) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12.5px]" data-testid="placeholder-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div>
        <p className="font-semibold">{t("campaigns.playbooks.fillTitle", { count: left.length })}</p>
        <p className="mt-0.5 text-muted">
          {left.slice(0, 8).map((x) => (
            <code key={x} className="me-1 rounded bg-surface px-1 py-0.5" dir="auto">
              [{x}]
            </code>
          ))}
        </p>
      </div>
    </div>
  );
}
