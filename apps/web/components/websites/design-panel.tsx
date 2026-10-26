"use client";

import { Check, Lock } from "lucide-react";
import { SITE_FONTS } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Card, Field, Input, Select } from "@/components/ui/primitives";
import { FONTS, ALL_TEMPLATES, fontsHref, type SiteTemplate } from "@/lib/site/templates";
import { cn } from "@/lib/utils";

/**
 * Wave 13 — choose a design template (live mini previews) and fine-tune it:
 * brand colours, font, corners, light/dark and animations. Premium templates are
 * shown to everyone but can be applied only on paid plans.
 */
export interface DesignTheme {
  accent: string;
  mode: "dark" | "light";
  template?: string;
  accent2?: string;
  font?: string;
  radius?: "sharp" | "soft" | "round";
  animations?: boolean;
}

function Mini({ tpl, active }: { tpl: SiteTemplate; active: boolean }) {
  const p = tpl.palette;
  const r = tpl.radius === "sharp" ? 2 : tpl.radius === "round" ? 14 : 8;
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: p.bg, fontFamily: `"${FONTS[tpl.display].family}", ${FONTS[tpl.display].fallback}` }} aria-hidden="true">
      {tpl.bg === "aurora" ? (
        <>
          <span className="absolute -start-6 -top-8 h-24 w-24 rounded-full blur-2xl" style={{ background: tpl.accent, opacity: 0.6 }} />
          <span className="absolute -bottom-8 -end-6 h-24 w-24 rounded-full blur-2xl" style={{ background: tpl.accent2, opacity: 0.5 }} />
        </>
      ) : tpl.bg === "grid" ? (
        <span className="absolute inset-0 opacity-40" style={{ backgroundImage: `linear-gradient(${p.line} 1px, transparent 1px), linear-gradient(90deg, ${p.line} 1px, transparent 1px)`, backgroundSize: "12px 12px" }} />
      ) : tpl.bg === "blobs" ? (
        <span className="absolute -end-6 -top-6 h-20 w-24" style={{ background: `${tpl.accent}2e`, borderRadius: "42% 58% 63% 37% / 41% 44% 56% 59%" }} />
      ) : tpl.bg === "glow" ? (
        <span className="absolute inset-0" style={{ background: `radial-gradient(60% 50% at 15% 0%, ${tpl.accent}66, transparent 70%)` }} />
      ) : tpl.bg === "dots" ? (
        <span className="absolute inset-0 opacity-50" style={{ backgroundImage: `radial-gradient(${p.fg}44 1px, transparent 1.2px)`, backgroundSize: "8px 8px" }} />
      ) : null}
      {tpl.hero === "cover" ? <span className="absolute inset-0" style={{ background: `linear-gradient(to top, ${p.bg}, ${tpl.accent}55)` }} /> : null}
      <div className={cn("relative flex h-full flex-col gap-1.5 p-3", tpl.hero === "centered" ? "items-center text-center" : "")}>
        <div className="flex w-full items-center justify-between">
          <span className="h-1.5 w-8 rounded-full" style={{ background: p.fg, opacity: 0.7 }} />
          <span className="h-2.5 w-6" style={{ background: tpl.accent, borderRadius: r }} />
        </div>
        <div className={cn("mt-1 flex flex-1 gap-2", tpl.hero === "split" ? "items-center" : "flex-col")}>
          <div className="flex-1 space-y-1">
            <div className="text-[13px] font-bold leading-tight" style={{ color: tpl.hero === "cover" ? "#fff" : p.fg }}>
              Aa
            </div>
            <span className="block h-1 w-14 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
            <span className="block h-1 w-10 rounded-full" style={{ background: p.muted, opacity: 0.4 }} />
            <span className={cn("mt-1 block h-2.5 w-10", tpl.cards === "brutal" && "ring-1 ring-black")} style={{ background: tpl.accent, borderRadius: r }} />
          </div>
          {tpl.hero === "split" || tpl.hero === "stacked" ? (
            <span className={tpl.hero === "split" ? "h-12 w-14 shrink-0" : "h-6 w-full"} style={{ background: `linear-gradient(135deg, ${tpl.accent}, ${tpl.accent2})`, borderRadius: r }} />
          ) : null}
        </div>
        <div className="grid w-full grid-cols-3 gap-1">
          {[0, 1, 2].map((k) => (
            <span
              key={k}
              className="h-3"
              style={{
                background: tpl.cards === "line" ? "transparent" : p.card,
                borderTop: `1px solid ${tpl.cards === "line" ? p.fg : p.line}`,
                border: tpl.cards === "brutal" ? `1px solid ${p.fg}` : undefined,
                boxShadow: tpl.cards === "brutal" ? `2px 2px 0 ${p.fg}` : undefined,
                borderRadius: tpl.cards === "line" ? 0 : r / 2,
              }}
            />
          ))}
        </div>
      </div>
      {active ? (
        <span className="absolute end-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent-solid text-white">
          <Check className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );
}

export function DesignPanel({ theme, onChange, proAllowed }: { theme: DesignTheme; onChange: (t: DesignTheme) => void; proAllowed: boolean }) {
  const { t, locale } = useI18n();
  const current = theme.template ?? "classic";
  return (
    <div className="space-y-4" data-testid="design-panel">
      <link rel="stylesheet" href={fontsHref(Object.keys(FONTS) as (keyof typeof FONTS)[]) ?? undefined} />
      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold">{t("websites.design.templates")}</h2>
        <p className="mb-4 text-[12.5px] text-muted">{t("websites.design.templatesHint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {ALL_TEMPLATES.map((tpl) => {
            const L = locale === "he" ? tpl.he : tpl.en;
            const locked = tpl.pro && !proAllowed;
            const active = current === tpl.key;
            return (
              <button
                key={tpl.key}
                type="button"
                data-template={tpl.key}
                aria-pressed={active}
                onClick={() => onChange({ ...theme, template: tpl.key, accent: tpl.accent, accent2: tpl.accent2, mode: tpl.mode, font: undefined, radius: undefined })}
                className={cn("group min-w-0 overflow-hidden rounded-xl border text-start transition", active ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-accent/60")}
              >
                <Mini tpl={tpl} active={active} />
                <span className="block px-2.5 pb-2.5 pt-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                    {L.name}
                    {tpl.pro ? (
                      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] font-medium", locked ? "bg-gold-soft text-gold" : "bg-accent-soft text-accent")}>
                        {locked ? <Lock className="h-2.5 w-2.5" /> : null} Pro
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{L.fits}</span>
                </span>
              </button>
            );
          })}
        </div>
        {ALL_TEMPLATES.find((x) => x.key === current)?.pro && !proAllowed ? (
          <p className="mt-3 rounded-lg bg-gold-soft px-3 py-2 text-[12.5px] text-gold" role="status" data-testid="template-locked">
            {t("websites.design.lockedNote")}
          </p>
        ) : null}
      </Card>

      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
        <Field label={t("websites.accent")} htmlFor="ds-accent">
          <div className="flex gap-2">
            <input type="color" aria-label={t("websites.accent")} value={theme.accent} onChange={(e) => onChange({ ...theme, accent: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-transparent" />
            <Input id="ds-accent" dir="ltr" value={theme.accent} onChange={(e) => onChange({ ...theme, accent: e.target.value })} />
          </div>
        </Field>
        <Field label={t("websites.design.accent2")} htmlFor="ds-accent2">
          <div className="flex gap-2">
            <input type="color" aria-label={t("websites.design.accent2")} value={theme.accent2 ?? "#22C3EE"} onChange={(e) => onChange({ ...theme, accent2: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-transparent" />
            <Input id="ds-accent2" dir="ltr" value={theme.accent2 ?? ""} placeholder="#22C3EE" onChange={(e) => onChange({ ...theme, accent2: e.target.value || undefined })} />
          </div>
        </Field>
        <Field label={t("websites.mode")} htmlFor="ds-mode">
          <Select id="ds-mode" value={theme.mode} onChange={(e) => onChange({ ...theme, mode: e.target.value as "dark" | "light" })}>
            <option value="dark">{t("common.dark")}</option>
            <option value="light">{t("common.light")}</option>
          </Select>
        </Field>
        <Field label={t("websites.design.font")} htmlFor="ds-font">
          <Select id="ds-font" value={theme.font ?? ""} onChange={(e) => onChange({ ...theme, font: e.target.value || undefined })}>
            <option value="">{t("websites.design.fontTemplate")}</option>
            {SITE_FONTS.map((f) => (
              <option key={f} value={f}>
                {FONTS[f].family}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("websites.design.radius")} htmlFor="ds-radius">
          <Select id="ds-radius" value={theme.radius ?? ""} onChange={(e) => onChange({ ...theme, radius: (e.target.value || undefined) as DesignTheme["radius"] })}>
            <option value="">{t("websites.design.fontTemplate")}</option>
            <option value="sharp">{t("websites.design.radiusSharp")}</option>
            <option value="soft">{t("websites.design.radiusSoft")}</option>
            <option value="round">{t("websites.design.radiusRound")}</option>
          </Select>
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 self-end pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={theme.animations !== false} onChange={(e) => onChange({ ...theme, animations: e.target.checked })} data-testid="ds-animations" />
          {t("websites.design.animations")}
        </label>
      </Card>
    </div>
  );
}
