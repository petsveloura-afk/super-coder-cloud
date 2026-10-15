import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { findNavItem } from "@/lib/navigation";
import { getT, resolveLocale } from "@/lib/i18n/server";

/**
 * Catch-all for modules that are scheduled but NOT yet implemented.
 * Honest by design: no fake buttons, no invented data — just the status.
 * Implemented modules have their own static routes, which take precedence.
 */
export default async function ModuleNotReady({ params }: { params: Promise<{ locale: string; module: string }> }) {
  const locale = await resolveLocale(params);
  const { module } = await params;
  const item = findNavItem(module);
  if (!item || item.phase === null) notFound();
  const { t } = await getT(locale);
  const name = t(item.label);
  return (
    <Card>
      <EmptyState
        icon={<Construction className="h-6 w-6" />}
        title={t("modules.notReadyTitle", { module: name })}
        body={t("modules.notReadyBody", { phase: item.phase })}
      />
    </Card>
  );
}
