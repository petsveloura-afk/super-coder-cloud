"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { isGuidePath, stepForPath } from "@/lib/guide/map";

/**
 * Wave 23 — a small help button on every screen: opens the guide at the step that explains
 * the screen the user is on (inbox → the inbox step, CRM → contacts, …). Stays clear of the
 * phone's bottom tab bar.
 */
export function GuideHelpButton() {
  const { t, locale } = useI18n();
  const pathname = usePathname() ?? "";
  if (isGuidePath(pathname)) return null;
  const step = stepForPath(pathname);
  const href = `/${locale}/guide${step ? `#${step}` : ""}`;
  // the agent setup page has its own floating "save" bar at the bottom → the button sits above it
  const raised = /\/ai-agents\/[^/]+\/setup/.test(pathname);
  return (
    <Link
      href={href}
      data-testid="guide-help"
      data-step={step ?? ""}
      aria-label={t("guide.help")}
      title={t("guide.help")}
      className={`fixed end-4 z-30 inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface/95 pe-4 ps-3 text-[13px] font-semibold text-fg shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-accent hover:text-accent ${raised ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-24" : "bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-6"}`}
    >
      <CircleHelp className="h-[18px] w-[18px] text-accent" aria-hidden />
      <span>{t("guide.helpShort")}</span>
    </Link>
  );
}
