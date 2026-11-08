"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Sparkles } from "lucide-react";
import { AUTOMATION_RECIPES, TRIGGER_CATEGORY_KEYS, matchesQuery, recipeCategory, type TriggerCategory } from "@scc/shared/automations";
import { useI18n } from "@/lib/i18n/client";
import { triggerLabel } from "@/lib/labels";
import { Badge, Card, CardHeader, Input } from "@/components/ui/primitives";
import { intelT } from "@/components/automations/intel-i18n";

/** Template gallery with category tabs and search (every recipe stays one click from the builder). */
export function RecipeGallery({ recommended = [] }: { recommended?: string[] }) {
  const { t, locale } = useI18n();
  const it = useMemo(() => intelT(locale), [locale]);
  const [cat, setCat] = useState<TriggerCategory | "all">("all");
  const [q, setQ] = useState("");

  const recipes = useMemo(() => AUTOMATION_RECIPES.map((r) => ({ ...r, category: recipeCategory(r.key, r.trigger_type) })), []);
  const countOf = (c: TriggerCategory | "all") => (c === "all" ? recipes.length : recipes.filter((r) => r.category === c).length);
  const shown = recipes.filter((r) => (cat === "all" || r.category === cat) && matchesQuery([t(`automations.recipes.${r.key}.name`), t(`automations.recipes.${r.key}.body`), triggerLabel(t, r.trigger_type)], q));

  return (
    <Card className="mb-4" data-testid="automation-templates">
      <CardHeader title={t("automations.templates")} description={t("automations.templatesHint")} />
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input type="search" aria-label={it("o.searchTemplates")} placeholder={it("o.searchTemplates")} value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("automations.templates")}>
          {(["all", ...TRIGGER_CATEGORY_KEYS] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cat === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-hover"}`}
            >
              {it(`c.${c}`)} <span className="tabular-nums opacity-70">{countOf(c)}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="p-5 text-center text-sm text-subtle">{it("o.noTemplates")}</p>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((r) => (
            <li key={r.key}>
              <Link href={`/${locale}/automations/new?recipe=${r.key}`} className="flex h-full flex-col gap-1.5 rounded-xl border border-line p-4 transition-colors hover:border-accent hover:bg-surface-hover">
                <span className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-4 w-4 text-gold" aria-hidden /> {t(`automations.recipes.${r.key}.name`)}
                </span>
                <span className="text-[12.5px] text-muted">{t(`automations.recipes.${r.key}.body`)}</span>
                <span className="mt-auto flex flex-wrap gap-1.5 pt-1.5">
                  <Badge tone="neutral">{it(`c.${r.category}`)}</Badge>
                  <Badge tone="neutral">{it("o.stepsCount", { count: r.actions.length })}</Badge>
                  {recommended.includes(r.key) ? <Badge tone="gold">{it("o.recommended")}</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
