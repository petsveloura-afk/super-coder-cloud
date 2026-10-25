"use client";

import { useMemo, useState } from "react";
import { Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  agentRoi,
  breakEven,
  campaign,
  commission,
  discount,
  employerCost,
  hourlyRate,
  IL_VAT,
  loan,
  ltv,
  margin,
  num,
  percentChange,
  priceForMargin,
  quickQuote,
  vat,
  type CalculatorKey,
} from "@/lib/calculators/core";

/**
 * Wave 24 — the calculators screen. Every calculator is a small definition (fields + compute) so
 * adding one is a few lines; the math lives in lib/calculators/core.ts (unit-tested).
 */
type Fmt = "money" | "pct" | "num" | "x";
interface Row { k: string; v: number | null; f: Fmt; main?: boolean }
interface Field { id: string; def: string; kind?: "money" | "pct" | "num" | "select"; options?: string[] }
interface Def { key: CalculatorKey; cat: Category; fields: Field[]; run: (v: Record<string, string>) => Row[] | null }

const CATEGORIES = ["all", "tax", "pricing", "sales", "marketing", "team"] as const;
type Category = Exclude<(typeof CATEGORIES)[number], "all">;

const DEFS: Def[] = [
  {
    key: "vat", cat: "tax",
    fields: [{ id: "amount", def: "1000", kind: "money" }, { id: "rate", def: String(IL_VAT), kind: "pct" }, { id: "mode", def: "add", kind: "select", options: ["add", "extract"] }],
    run: (v) => { const r = vat(num(v.amount), num(v.rate), v.mode === "extract" ? "extract" : "add"); return r && [{ k: "gross", v: r.gross, f: "money", main: true }, { k: "net", v: r.net, f: "money" }, { k: "vatPart", v: r.vat, f: "money" }]; },
  },
  {
    key: "margin", cat: "pricing",
    fields: [{ id: "cost", def: "60", kind: "money" }, { id: "price", def: "100", kind: "money" }, { id: "wanted", def: "40", kind: "pct" }],
    run: (v) => { const r = margin(num(v.cost), num(v.price)); if (!r) return null; return [{ k: "profit", v: r.profit, f: "money", main: true }, { k: "marginPct", v: r.marginPct, f: "pct" }, { k: "markupPct", v: r.markupPct, f: "pct" }, { k: "priceForWanted", v: priceForMargin(num(v.cost), num(v.wanted)), f: "money" }]; },
  },
  {
    key: "discount", cat: "pricing",
    fields: [{ id: "price", def: "500", kind: "money" }, { id: "pct", def: "15", kind: "pct" }, { id: "extra", def: "0", kind: "pct" }],
    run: (v) => { const r = discount(num(v.price), num(v.pct), num(v.extra) || 0); return r && [{ k: "final", v: r.final, f: "money", main: true }, { k: "saved", v: r.saved, f: "money" }, { k: "effectivePct", v: r.effectivePct, f: "pct" }]; },
  },
  {
    key: "quote", cat: "sales",
    fields: [{ id: "q1", def: "1", kind: "num" }, { id: "p1", def: "1200", kind: "money" }, { id: "q2", def: "3", kind: "num" }, { id: "p2", def: "150", kind: "money" }, { id: "q3", def: "0", kind: "num" }, { id: "p3", def: "0", kind: "money" }, { id: "disc", def: "0", kind: "pct" }, { id: "rate", def: String(IL_VAT), kind: "pct" }],
    run: (v) => { const r = quickQuote([1, 2, 3].map((i) => ({ qty: num(v[`q${i}`]) || 0, price: num(v[`p${i}`]) || 0 })), num(v.disc) || 0, num(v.rate)); return r && [{ k: "total", v: r.total, f: "money", main: true }, { k: "subtotal", v: r.subtotal, f: "money" }, { k: "discountAmt", v: r.discount, f: "money" }, { k: "net", v: r.net, f: "money" }, { k: "vatPart", v: r.vat, f: "money" }]; },
  },
  {
    key: "loan", cat: "tax",
    fields: [{ id: "principal", def: "50000", kind: "money" }, { id: "annual", def: "6", kind: "pct" }, { id: "months", def: "36", kind: "num" }],
    run: (v) => { const r = loan(num(v.principal), num(v.annual), num(v.months)); return r && [{ k: "monthly", v: r.monthly, f: "money", main: true }, { k: "totalPaid", v: r.total, f: "money" }, { k: "interest", v: r.interest, f: "money" }]; },
  },
  {
    key: "breakEven", cat: "pricing",
    fields: [{ id: "fixed", def: "20000", kind: "money" }, { id: "price", def: "250", kind: "money" }, { id: "variable", def: "90", kind: "money" }],
    run: (v) => { const r = breakEven(num(v.fixed), num(v.price), num(v.variable)); return r && [{ k: "units", v: r.units, f: "num", main: true }, { k: "revenue", v: r.revenue, f: "money" }, { k: "contribution", v: r.contribution, f: "money" }]; },
  },
  {
    key: "commission", cat: "sales",
    fields: [{ id: "sales", def: "80000", kind: "money" }, { id: "pct", def: "5", kind: "pct" }, { id: "target", def: "60000", kind: "money" }, { id: "bonus", def: "3", kind: "pct" }],
    run: (v) => { const r = commission(num(v.sales), num(v.pct), num(v.target) || 0, num(v.bonus) || 0); return r && [{ k: "totalCommission", v: r.total, f: "money", main: true }, { k: "base", v: r.base, f: "money" }, { k: "bonusAmt", v: r.bonus, f: "money" }]; },
  },
  {
    key: "hourly", cat: "team",
    fields: [{ id: "goal", def: "18000", kind: "money" }, { id: "expenses", def: "3000", kind: "money" }, { id: "hours", def: "100", kind: "num" }, { id: "tax", def: "30", kind: "pct" }],
    run: (v) => { const r = hourlyRate(num(v.goal), num(v.expenses), num(v.hours), num(v.tax)); return r && [{ k: "rate", v: r.rate, f: "money", main: true }, { k: "rateWithVat", v: r.rateWithVat, f: "money" }, { k: "monthlyRevenue", v: r.monthlyRevenue, f: "money" }]; },
  },
  {
    key: "employer", cat: "team",
    fields: [{ id: "gross", def: "10000", kind: "money" }, { id: "addons", def: "18.5", kind: "pct" }],
    run: (v) => { const r = employerCost(num(v.gross), num(v.addons)); return r && [{ k: "employerTotal", v: r.total, f: "money", main: true }, { k: "addOns", v: r.addOns, f: "money" }, { k: "yearly", v: r.yearly, f: "money" }]; },
  },
  {
    key: "roi", cat: "marketing",
    fields: [{ id: "convs", def: "600", kind: "num" }, { id: "minutes", def: "6", kind: "num" }, { id: "hourCost", def: "60", kind: "money" }, { id: "cost", def: "299", kind: "money" }, { id: "deals", def: "4", kind: "num" }, { id: "dealValue", def: "800", kind: "money" }],
    run: (v) => { const r = agentRoi(num(v.convs), num(v.minutes), num(v.hourCost), num(v.cost), num(v.deals) || 0, num(v.dealValue) || 0); return r && [{ k: "netGain", v: r.net, f: "money", main: true }, { k: "hoursSaved", v: r.hoursSaved, f: "num" }, { k: "value", v: r.value, f: "money" }, { k: "roiPct", v: r.roiPct, f: "pct" }]; },
  },
  {
    key: "ltv", cat: "marketing",
    fields: [{ id: "order", def: "350", kind: "money" }, { id: "perYear", def: "4", kind: "num" }, { id: "years", def: "3", kind: "num" }, { id: "marginPct", def: "40", kind: "pct" }],
    run: (v) => { const r = ltv(num(v.order), num(v.perYear), num(v.years), num(v.marginPct)); return r && [{ k: "ltvValue", v: r.ltv, f: "money", main: true }, { k: "maxCac", v: r.maxCac, f: "money" }]; },
  },
  {
    key: "campaign", cat: "marketing",
    fields: [{ id: "spend", def: "3000", kind: "money" }, { id: "leads", def: "120", kind: "num" }, { id: "customers", def: "15", kind: "num" }, { id: "revenue", def: "12000", kind: "money" }],
    run: (v) => { const r = campaign(num(v.spend), num(v.leads), num(v.customers), num(v.revenue)); return r && [{ k: "roas", v: r.roas, f: "x", main: true }, { k: "cpl", v: r.cpl, f: "money" }, { k: "cac", v: r.cac, f: "money" }, { k: "conversionPct", v: r.conversionPct, f: "pct" }]; },
  },
  {
    key: "percent", cat: "sales",
    fields: [{ id: "from", def: "40000", kind: "num" }, { id: "to", def: "52000", kind: "num" }],
    run: (v) => [{ k: "change", v: percentChange(num(v.from), num(v.to)), f: "pct", main: true }],
  },
];

const initial = () => Object.fromEntries(DEFS.map((d) => [d.key, Object.fromEntries(d.fields.map((f) => [f.id, f.def]))])) as Record<CalculatorKey, Record<string, string>>;

export function CalculatorsClient({ currency }: { currency: string }) {
  const { t, locale } = useI18n();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("all");
  const [vals, setVals] = useState(initial);
  const shown = useMemo(() => DEFS.filter((d) => cat === "all" || d.cat === cat), [cat]);

  const fmt = (r: Row) => {
    if (r.v === null || !Number.isFinite(r.v)) return "—";
    if (r.f === "money") return formatCurrency(locale, r.v, currency);
    if (r.f === "pct") return `${r.v.toLocaleString(locale === "en" ? "en-US" : "he-IL", { maximumFractionDigits: 2 })}%`;
    if (r.f === "x") return `×${r.v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return r.v.toLocaleString(locale === "en" ? "en-US" : "he-IL", { maximumFractionDigits: 2 });
  };

  return (
    <>
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t("calculators.categories")}>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition", cat === c ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
            {t(`calculators.cat.${c}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((d) => {
          const v = vals[d.key];
          const rows = d.run(v);
          const main = rows?.find((r) => r.main);
          return (
            <section key={d.key} data-testid={`calc-${d.key}`} className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="pointer-events-none absolute -end-10 -top-10 h-28 w-28 rounded-full bg-accent/10 blur-2xl transition group-hover:bg-accent/20" aria-hidden />
              <header className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{t(`calculators.${d.key}.title`)}</h2>
                  <p className="text-[12px] text-muted">{t(`calculators.${d.key}.desc`)}</p>
                </div>
                <button type="button" aria-label={t("calculators.reset")} title={t("calculators.reset")} onClick={() => setVals((s) => ({ ...s, [d.key]: initial()[d.key] }))} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-subtle hover:bg-surface-hover">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </header>
              <div className="grid grid-cols-2 gap-2">
                {d.fields.map((f) => (
                  <label key={f.id} className="grid gap-1 text-[11.5px] font-medium text-muted">
                    {t(`calculators.${d.key}.f.${f.id}`)}
                    {f.kind === "select" ? (
                      <select value={v[f.id]} onChange={(e) => setVals((s) => ({ ...s, [d.key]: { ...s[d.key], [f.id]: e.target.value } }))} className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg">
                        {f.options?.map((o) => (
                          <option key={o} value={o}>{t(`calculators.${d.key}.o.${o}`)}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="relative" dir="ltr">
                        <input inputMode="decimal" value={v[f.id]} onChange={(e) => setVals((s) => ({ ...s, [d.key]: { ...s[d.key], [f.id]: e.target.value } }))} className="h-9 w-full rounded-lg border border-line bg-surface px-2.5 pe-7 text-[13px] tabular-nums text-fg outline-none focus:border-accent" />
                        <span className="pointer-events-none absolute inset-y-0 end-2 grid place-items-center text-[11px] text-subtle">{f.kind === "pct" ? "%" : f.kind === "money" ? (currency === "ILS" ? "₪" : currency) : ""}</span>
                      </div>
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-3 rounded-xl bg-gradient-to-br from-accent-soft to-surface p-3">
                {rows ? (
                  <>
                    {main ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-muted">{t(`calculators.r.${main.k}`)}</span>
                        <button type="button" onClick={() => { void navigator.clipboard?.writeText(fmt(main)); toast.success(t("calculators.copied")); }} className="inline-flex items-center gap-1 text-[11px] text-subtle hover:text-accent" aria-label={t("calculators.copy")}>
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null}
                    {main ? <p className="text-2xl font-bold tabular-nums text-accent" dir="ltr" data-testid={`calc-${d.key}-main`}>{fmt(main)}</p> : null}
                    <dl className="mt-1.5 grid gap-0.5">
                      {rows.filter((r) => !r.main).map((r) => (
                        <div key={r.k} className="flex justify-between gap-2 text-[12.5px]">
                          <dt className="text-muted">{t(`calculators.r.${r.k}`)}</dt>
                          <dd className="font-semibold tabular-nums" dir="ltr">{fmt(r)}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <p className="text-[12.5px] text-subtle">{t("calculators.invalid")}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-[11.5px] text-subtle">{t("calculators.disclaimer")}</p>
    </>
  );
}
