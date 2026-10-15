import { isUnlimited, usageRatio } from "@scc/shared/billing";
import { cn } from "@/lib/utils";

export function UsageMeter({
  label,
  used,
  limit,
  unlimitedLabel,
  ofLabel,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
  unlimitedLabel: string;
  ofLabel: string;
}) {
  const ratio = usageRatio(used, limit);
  const tone = ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warning" : "bg-brand";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold" dir="ltr">
          {isUnlimited(limit) ? `${used.toLocaleString()} · ${unlimitedLabel}` : ofLabel}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={isUnlimited(limit) ? undefined : (limit ?? undefined)}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}
