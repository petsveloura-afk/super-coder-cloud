"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarCheck, CheckCircle2, Globe, Hand, MessagesSquare, Sparkles, UserPlus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "@/components/ui/primitives";

/** "What the AI agent does for you" — plain-language explanation on the AI agents page. */
export function AutopilotExplainer({ locale, active, action }: { locale: string; active: boolean; action?: ReactNode }) {
  const { t } = useI18n();
  const items = [
    { icon: MessagesSquare, title: t("ai.explain.answersTitle"), body: t("ai.explain.answersBody") },
    { icon: UserPlus, title: t("ai.explain.leadsTitle"), body: t("ai.explain.leadsBody") },
    { icon: CalendarCheck, title: t("ai.explain.bookTitle"), body: t("ai.explain.bookBody") },
    { icon: Hand, title: t("ai.explain.handoffTitle"), body: t("ai.explain.handoffBody") },
    { icon: Globe, title: t("ai.explain.sitesTitle"), body: t("ai.explain.sitesBody") },
  ];
  return (
    <Card className="mb-4 overflow-hidden" data-testid="autopilot-explainer">
      <div className="flex flex-col gap-3 border-b border-line bg-gradient-to-l from-accent-soft/60 to-transparent p-5 sm:flex-row sm:items-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-solid text-accent-fg">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("ai.explain.title")}</h2>
          <p className="text-[13px] text-muted">{t("ai.explain.subtitle")}</p>
        </div>
        {active ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-[12.5px] font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> {t("ai.explain.active")}
          </span>
        ) : (
          action
        )}
      </div>
      <ul className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-5">
        {items.map((it) => (
          <li key={it.title} className="flex gap-3 bg-surface p-4">
            <it.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div>
              <div className="text-[13.5px] font-semibold">{it.title}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{it.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[12.5px] text-muted">
        <span>{t("ai.explain.how")}</span>
        <Link href={`/${locale}/integrations`} className="font-medium text-accent hover:underline">
          {t("ai.explain.connect")}
        </Link>
        <Link href={`/${locale}/inbox`} className="font-medium text-accent hover:underline">
          {t("ai.explain.inbox")}
        </Link>
      </div>
    </Card>
  );
}
