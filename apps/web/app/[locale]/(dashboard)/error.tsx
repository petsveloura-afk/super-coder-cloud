"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6 text-danger" />}
        title={t("errors.generic")}
        body={error.digest ? `ref: ${error.digest}` : undefined}
        action={<Button onClick={reset}>{t("common.retry")}</Button>}
      />
    </Card>
  );
}
