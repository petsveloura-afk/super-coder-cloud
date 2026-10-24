import Link from "next/link";
import { Bot, Hourglass, MessageSquareReply, Sparkles, UserPlus, Zap } from "lucide-react";
import type { AiPulse } from "@/lib/dashboard/pulse";
import { secondsLabel } from "@/lib/dashboard/pulse-core";
import { formatNumber } from "@/lib/format";
import type { TKey } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

/** Wave 20 — the overview's signature: what the AI agent did for the business today, live. */
export function AiPulseBand({ pulse, locale, t }: { pulse: AiPulse; locale: Locale; t: (k: TKey, p?: Record<string, string>) => string }) {
  const avg = secondsLabel(pulse.avgReplyMs);
  const figures = [
    { icon: MessageSquareReply, value: formatNumber(locale, pulse.repliesToday), label: t("dashboard.pulse.replies"), href: `/${locale}/inbox` },
    { icon: UserPlus, value: formatNumber(locale, pulse.leadsToday), label: t("dashboard.pulse.leads"), href: `/${locale}/crm` },
    { icon: Zap, value: avg ?? "—", unit: avg ? t("dashboard.pulse.sec") : undefined, label: t("dashboard.pulse.speed"), href: `/${locale}/inbox` },
    { icon: Hourglass, value: formatNumber(locale, pulse.waiting), label: t("dashboard.pulse.waiting"), href: `/${locale}/inbox`, alert: pulse.waiting > 0 },
  ];
  return (
    <section className="ai-pulse mb-4 rounded-[1.5rem] p-4 sm:p-5" aria-label={t("dashboard.pulse.title")} data-testid="ai-pulse">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            {pulse.agentOn ? <span className="live-dot" aria-hidden /> : null}
            {pulse.agentOn ? t("dashboard.pulse.on", { name: pulse.agentName ?? "" }) : t("dashboard.pulse.off")}
          </p>
          <p className="text-[12.5px] text-muted">{t(pulse.agentOn ? "dashboard.pulse.onSub" : "dashboard.pulse.offSub")}</p>
        </div>
        <Link
          href={`/${locale}/ai-agents`}
          className={pulse.agentOn ? "text-[13px] font-semibold text-accent hover:underline" : "btn-brand inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-[13.5px] font-semibold text-white"}
        >
          {pulse.agentOn ? t("dashboard.pulse.settings") : (
            <>
              <Sparkles className="h-4 w-4" /> {t("dashboard.pulse.start")}
            </>
          )}
        </Link>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {figures.map((f) => (
          <li key={f.label}>
            <Link href={f.href} className="group block rounded-xl">
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted group-hover:text-fg">
                <f.icon className="h-3.5 w-3.5" aria-hidden /> {f.label}
              </span>
              <span className={`pulse-figure mt-1.5 block ${f.alert ? "text-warning" : "text-fg"}`}>
                <span dir="ltr">{f.value}</span>
                {f.unit ? <span className="ms-1 text-[14px] font-semibold text-muted">{f.unit}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
