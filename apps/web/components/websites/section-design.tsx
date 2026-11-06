"use client";

import { Palette } from "lucide-react";
import type { BlockStyle } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { SECTION_ALIGNS, SECTION_HIDES, SECTION_PADS, cleanSectionStyle } from "@/lib/site/section-style";
import { SECTION_ANIMS, SECTION_BGS } from "@scc/shared/engagement";

/**
 * The section inspector (like a page builder's): how this section enters, its background, spacing, heading alignment
 * and on which devices it shows. Folded by default; a dot shows when the section has its own design.
 */
const SWATCH: Record<string, string> = {
  auto: "bg-[repeating-linear-gradient(45deg,var(--border)_0_4px,transparent_4px_8px)]",
  plain: "bg-surface",
  tint: "bg-surface-hover",
  accent: "bg-accent-soft",
  gradient: "bg-gradient-to-br from-accent-soft to-teal-500/20",
  dark: "bg-[#0b0f17]",
};

export function SectionDesign({ value, onChange, index }: { value: BlockStyle | null | undefined; onChange: (v: BlockStyle | undefined) => void; index: number }) {
  const { t } = useI18n();
  const cur = cleanSectionStyle(value) ?? {};
  const set = (k: keyof BlockStyle, v: string) => onChange(cleanSectionStyle({ ...cur, [k]: v }) ?? undefined);
  const has = Object.keys(cur).length > 0;
  const sel = "h-9 w-full rounded-lg border border-line bg-elevated px-2 text-[13px]";
  return (
    <details className="group mb-3 rounded-xl border border-line bg-elevated/60 open:bg-elevated" data-testid={`section-design-${index}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-muted hover:text-fg">
        <Palette className="h-3.5 w-3.5 text-accent" />
        {t("websites.sectionDesign.title")}
        {has ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={t("websites.sectionDesign.custom")} /> : null}
        <span className="ms-auto text-[11.5px] text-subtle group-open:hidden">{t("websites.sectionDesign.hint")}</span>
      </summary>
      <div className="space-y-3 border-t border-line p-3">
        <div>
          <p className="mb-1.5 text-[12px] text-muted">{t("websites.sectionDesign.bg")}</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("websites.sectionDesign.bg")}>
            {SECTION_BGS.map((b) => {
              const on = (cur.bg ?? "auto") === b;
              return (
                <button key={b} type="button" role="radio" aria-checked={on} onClick={() => set("bg", b)} className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition", on ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent")}>
                  <span className={cn("h-4 w-4 rounded border border-line", SWATCH[b])} aria-hidden />
                  {t(`websites.sectionDesign.bgs.${b}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="text-[12px] text-muted">
            {t("websites.sectionDesign.anim")}
            <select className={sel} value={cur.anim ?? "auto"} onChange={(e) => set("anim", e.target.value)}>
              {SECTION_ANIMS.map((a) => (
                <option key={a} value={a}>
                  {t(`websites.sectionDesign.anims.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            {t("websites.sectionDesign.pad")}
            <select className={sel} value={cur.pad ?? "auto"} onChange={(e) => set("pad", e.target.value)}>
              {SECTION_PADS.map((a) => (
                <option key={a} value={a}>
                  {t(`websites.sectionDesign.pads.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            {t("websites.sectionDesign.align")}
            <select className={sel} value={cur.align ?? "auto"} onChange={(e) => set("align", e.target.value)}>
              {SECTION_ALIGNS.map((a) => (
                <option key={a} value={a}>
                  {t(`websites.sectionDesign.aligns.${a}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            {t("websites.sectionDesign.hide")}
            <select className={sel} value={cur.hide ?? "none"} onChange={(e) => set("hide", e.target.value)}>
              {SECTION_HIDES.map((a) => (
                <option key={a} value={a}>
                  {t(`websites.sectionDesign.hides.${a}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {has ? (
          <button type="button" className="text-[12px] text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => onChange(undefined)}>
            {t("websites.sectionDesign.reset")}
          </button>
        ) : null}
      </div>
    </details>
  );
}
