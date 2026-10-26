"use client";

import { LayoutTemplate, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "@/components/ui/primitives";
import { STARTER_KITS, type StarterKit } from "@/lib/site/starter-kits";

/**
 * Wave 27 — industry starter kits. Adds a ready set of sections to the END of the
 * current site (nothing is removed or replaced); the parent decides what to do with the pick.
 */
export function StarterKits({ onPick }: { onPick: (kit: StarterKit) => void }) {
  const { t, locale } = useI18n();
  const lang = locale === "he" ? "he" : "en";
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="starter-kits">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <LayoutTemplate className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("websites.kits.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("websites.kits.hint")}</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {STARTER_KITS.map((k) => (
          <li key={k.key}>
            <button
              type="button"
              data-kit={k.key}
              onClick={() => onPick(k)}
              className="group flex w-full min-w-0 items-center gap-3 rounded-xl border border-line p-3 text-start transition hover:border-accent/60 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="flex shrink-0 -space-x-1 rtl:space-x-reverse" aria-hidden>
                <span className="h-5 w-5 rounded-full border border-surface" style={{ background: k.accent }} />
                <span className="h-5 w-5 rounded-full border border-surface" style={{ background: k.accent2 }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{k.name[lang]}</span>
                <span className="block truncate text-[11.5px] text-muted">{k.fits[lang]}</span>
              </span>
              <Plus className="h-4 w-4 shrink-0 text-muted group-hover:text-accent" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
