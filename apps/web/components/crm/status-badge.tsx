"use client";

import type { ContactStatus } from "@scc/database";
import { Badge } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

const TONE = { lead: "accent", qualified: "gold", customer: "success", inactive: "neutral" } as const;

export function StatusBadge({ status }: { status: ContactStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`crm.statuses.${status}`)}</Badge>;
}
