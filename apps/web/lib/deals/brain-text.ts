import type { HealthReason } from "@/lib/deals/brain";

/**
 * Server-safe twin of `reasonText` in components/pipelines/pipeline-brain.tsx (that file is "use client",
 * so a server component may not call its functions — doing so crashed the "smart list" view).
 * Same output, usable from server and client code.
 */
export function dealReasonText(t: (k: string, p?: Record<string, string | number>) => string, reasons: HealthReason[]): string {
  return reasons.map((r) => t(`deals.brain.reasons.${r}`)).join(" · ");
}
