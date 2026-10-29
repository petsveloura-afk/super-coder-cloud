import { Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";
import { FUNNEL_PATH, funnelRank, funnelRows } from "@/lib/ai/sales-state-core";
import { featureAccess } from "@/lib/billing/features";
import { FeatureLock } from "@/components/billing/feature-gate";

/**
 * Wave 55 — the live sales funnel of the AI agents (last 60 days, RLS-scoped): how many conversations
 * are in each state, from new lead to booked meeting, plus objections and handoffs. Renders nothing
 * before the migration ran or when there is no data yet.
 */
export async function SalesFunnel({ orgId, locale, canTrial = false }: { orgId: string; locale: Locale; canTrial?: boolean }) {
  const supabase = await createClient();
  const since = new Date(new Date().getTime() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("conversations").select("sales_state").eq("organization_id", orgId).not("sales_state", "is", null).gte("last_message_at", since).limit(5000);
  if (error) return null;
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { sales_state: string }[]) counts[r.sales_state] = (counts[r.sales_state] ?? 0) + 1;
  const rows = funnelRows(counts);
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (!total) return null;
  // wave 55: the funnel analytics are part of "advanced analytics" (Pro) — with a 7-day free trial
  const access = await featureAccess(orgId, "advanced_analytics");
  if (!access.allowed) {
    return (
      <div className="mb-4">
        <FeatureLock locale={locale} feature="advanced_analytics" plan="pro" access={access} canTrial={canTrial} />
      </div>
    );
  }
  const { t } = await getT(locale);
  // "reached at least this step" — a booked meeting also passed every earlier step
  const reached = (rank: number) => rows.filter((r) => r.state !== "HUMAN_HANDOFF" && funnelRank(r.state) >= rank).reduce((a, r) => a + r.count, 0);
  const top = Math.max(1, reached(0));
  const side = rows.filter((r) => r.state === "OBJECTION_HANDLING" || r.state === "HUMAN_HANDOFF");
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4" data-testid="sales-funnel">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-semibold">
          <Filter className="h-4 w-4 text-accent" aria-hidden /> {t("sales.funnel.title")}
        </h2>
        <span className="text-[12px] text-subtle">{t("sales.funnel.period")}</span>
      </div>
      <ol className="space-y-1.5">
        {FUNNEL_PATH.map((s) => {
          const n = reached(funnelRank(s));
          const pct = Math.round((n / top) * 100);
          const now = rows.find((r) => r.state === s)?.count ?? 0;
          return (
            <li key={s} className="grid grid-cols-[minmax(7.5rem,10rem)_1fr_auto] items-center gap-2 text-[13px]" data-funnel-state={s}>
              <span className="truncate text-muted">{t(`sales.state.${s}`)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-elevated" aria-hidden>
                <span className="block h-full rounded-full bg-accent-solid transition-[width] duration-500" style={{ width: `${Math.max(pct, n ? 3 : 0)}%` }} />
              </span>
              <span className="min-w-[4.5rem] text-end tabular-nums">
                <b>{formatNumber(locale, n)}</b> <span className="text-subtle">({pct}%)</span>
                {now ? <span className="sr-only"> · {t("sales.funnel.now", { n: String(now) })}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3 text-[12.5px]">
        {side.map((r) => (
          <span key={r.state} className="rounded-lg bg-elevated px-2.5 py-1">
            {t(`sales.state.${r.state}`)}: <b className="tabular-nums">{formatNumber(locale, r.count)}</b>
          </span>
        ))}
      </div>
    </section>
  );
}
