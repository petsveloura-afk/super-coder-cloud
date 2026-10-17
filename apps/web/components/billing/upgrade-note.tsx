import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

/** Wave 13 — "this is part of a paid plan" note with a link to billing. */
export async function UpgradeNote({ locale, feature, plan = "pro", compact = false }: { locale: Locale; feature: string; plan?: "pro" | "business"; compact?: boolean }) {
  const { t } = await getT(locale);
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-gold/30 bg-gold-soft ${compact ? "px-3 py-2.5" : "p-4"}`} data-testid={`upgrade-${feature}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
        <Lock className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t(`plans.locked.${feature}.title`)}</p>
        <p className="text-[12.5px] leading-relaxed text-muted">{t(`plans.locked.${feature}.body`, { plan: t(`billing.plans.${plan}.name`) })}</p>
      </div>
      <Link href={`/${locale}/billing`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent-solid px-3.5 text-sm font-semibold text-white hover:bg-accent-solid-hover">
        <Sparkles className="h-4 w-4" /> {t("plans.locked.cta", { plan: t(`billing.plans.${plan}.name`) })}
      </Link>
    </div>
  );
}
