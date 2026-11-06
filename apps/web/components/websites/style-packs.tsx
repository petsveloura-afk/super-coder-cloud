"use client";

import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { SiteValue } from "./site-builder";
import { STYLE_PACKS, applyStylePack, packTheme, type StylePack } from "@/lib/site/section-style";

/**
 * One-click site styles: a whole professional look (font, corners, buttons, hover, entrances, header, effects, section
 * shapes) AND a rhythm of section backgrounds. Content, colours and light/dark stay as they are; undo brings it back.
 */
const LOOK: Record<StylePack, { bg: string; fg: string; a: string; r: number; font: string }> = {
  elegant: { bg: "#0f0e0c", fg: "#efe6d6", a: "#c8a96a", r: 2, font: "serif" },
  bold: { bg: "#ffffff", fg: "#111111", a: "#ff3d57", r: 10, font: "system-ui" },
  minimal: { bg: "#fafafa", fg: "#1f2937", a: "#111827", r: 8, font: "system-ui" },
  playful: { bg: "#fff7ed", fg: "#3b2f2f", a: "#f97316", r: 18, font: "system-ui" },
  corporate: { bg: "#f8fafc", fg: "#0f172a", a: "#1d4ed8", r: 8, font: "system-ui" },
  cinematic: { bg: "#05060a", fg: "#f1f5f9", a: "#a78bfa", r: 2, font: "serif" },
  warm: { bg: "#fffaf3", fg: "#3f3a33", a: "#c2703d", r: 18, font: "system-ui" },
  tech: { bg: "#0a0f1f", fg: "#e2e8f0", a: "#22d3ee", r: 10, font: "system-ui" },
};

export function StylePacks({ value, onApply }: { value: SiteValue; onApply: (next: SiteValue) => void }) {
  const { t } = useI18n();
  const current = (["buttons", "hover", "entrance", "header"] as const).map((k) => value.theme[k] ?? "").join("|");
  return (
    <Card className="mb-4 p-4" data-testid="style-packs">
      <div className="mb-3 flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-accent" />
        <h3 className="text-[14px] font-semibold">{t("websites.stylePacks.title")}</h3>
        <span className="text-[12px] text-muted">{t("websites.stylePacks.hint")}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STYLE_PACKS.map((p) => {
          const l = LOOK[p];
          const th = packTheme(p);
          const on = current === [th.buttons, th.hover, th.entrance, th.header].join("|");
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              data-testid={`style-pack-${p}`}
              onClick={() => {
                onApply(applyStylePack(value as unknown as Parameters<typeof applyStylePack>[0], p) as unknown as SiteValue);
                toast.success(t("websites.stylePacks.applied", { name: t(`websites.stylePacks.items.${p}`) }));
              }}
              className={cn("group overflow-hidden rounded-xl border text-start transition hover:-translate-y-0.5 hover:shadow-md", on ? "border-accent ring-2 ring-accent/40" : "border-line")}
            >
              <div className="relative h-20 overflow-hidden" style={{ background: l.bg, fontFamily: l.font }} aria-hidden>
                <span className="absolute inset-x-3 top-3 h-1.5 w-10 rounded-full" style={{ background: l.fg, opacity: 0.6 }} />
                <span className="absolute start-3 top-7 text-[15px] font-bold" style={{ color: l.fg }}>
                  Aa
                </span>
                <span className="absolute bottom-3 start-3 h-4 w-12 transition-transform duration-300 group-hover:scale-105" style={{ background: th.buttons === "outline" ? "transparent" : th.buttons === "gradient" ? `linear-gradient(120deg, ${l.a}, ${l.fg})` : l.a, border: th.buttons === "outline" ? `1.5px solid ${l.a}` : undefined, borderRadius: th.buttons === "pill" ? 99 : l.r }} />
                <span className="absolute bottom-3 end-3 h-8 w-12 transition-transform duration-300 group-hover:-translate-y-1" style={{ background: l.fg, opacity: 0.08, borderRadius: l.r }} />
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[12.5px] font-semibold">{t(`websites.stylePacks.items.${p}`)}</p>
                <p className="line-clamp-2 text-[11px] text-muted">{t(`websites.stylePacks.desc.${p}`)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
