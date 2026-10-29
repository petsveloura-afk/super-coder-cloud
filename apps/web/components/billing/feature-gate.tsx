import Link from "next/link";
import { Clock, Lock, Sparkles } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import type { FeatureAccess } from "@/lib/billing/features";
import { TrialButton } from "./trial-button";

/**
 * Wave 55 — a paid feature, like the market: when it is locked the business sees what it is, which plan
 * includes it, a 7-day free trial (once) and the upgrade; during a trial a small "trial · N days left" note.
 */
export async function FeatureLock({ locale, feature, plan = "pro", access, canTrial }: { locale: Locale; feature: string; plan?: "pro" | "business"; access: FeatureAccess; canTrial: boolean }) {
  const { t } = await getT(locale);
  const planName = t(`billing.plans.${plan}.name`);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/30 bg-gold-soft p-4" data-testid={`locked-${feature}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
        <Lock className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-semibold">{t(`plans.locked.${feature}.title`)}</p>
        <p className="text-[12.5px] leading-relaxed text-muted">{t(`plans.locked.${feature}.body`, { plan: planName })}</p>
        {!access.trialAvailable && access.trialEndsAt ? <p className="mt-1 text-[12px] text-subtle">{t("trial.ended")}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {access.trialAvailable && canTrial ? <TrialButton feature={feature} /> : null}
        <Link href={`/${locale}/billing`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent-solid px-3.5 text-sm font-semibold text-accent-fg hover:bg-accent-solid-hover">
          <Sparkles className="h-4 w-4" aria-hidden /> {t("plans.locked.cta", { plan: planName })}
        </Link>
      </div>
    </div>
  );
}

/** Shown while the feature runs on a free trial. */
export async function TrialNote({ locale, access }: { locale: Locale; access: FeatureAccess }) {
  if (access.via !== "trial" || !access.trialEndsAt) return null;
  const { t } = await getT(locale);
  const days = Math.max(0, Math.ceil((new Date(access.trialEndsAt).getTime() - new Date().getTime()) / 86_400_000));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[12.5px]" data-testid="trial-note">
      <Clock className="h-4 w-4 text-accent" aria-hidden />
      <span className="flex-1">{t("trial.active", { n: String(days) })}</span>
      <Link href={`/${locale}/billing`} className="font-semibold text-accent hover:underline">
        {t("trial.keep")}
      </Link>
    </div>
  );
}
