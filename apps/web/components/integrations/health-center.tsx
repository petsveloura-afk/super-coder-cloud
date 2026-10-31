import Link from "next/link";
import { Activity, CheckCircle2, CircleAlert, CircleDashed, PlugZap, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { ChannelHealthRow } from "@/lib/channels/health";
import type { HealthLevel } from "@/lib/channels/health-core";

const LEVEL: Record<HealthLevel, { icon: typeof CheckCircle2; cls: string; dot: string }> = {
  ok: { icon: CheckCircle2, cls: "text-success", dot: "bg-success" },
  quiet: { icon: CircleDashed, cls: "text-muted", dot: "bg-line-strong" },
  warning: { icon: TriangleAlert, cls: "text-warning", dot: "bg-warning" },
  error: { icon: CircleAlert, cls: "text-danger", dot: "bg-danger" },
};

/**
 * Wave 59 — connection health center (top of integrations): every connected channel with its real state.
 * A broken one shows what happened and a one-click way back to fix it; the owner also gets one alert (cron).
 */
export async function HealthCenter({ rows, overall, locale }: { rows: ChannelHealthRow[]; overall: HealthLevel; locale: "he" | "en" | "ar" }) {
  if (!rows.length) return null;
  const { t } = await getT(locale);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("health.never"));
  const O = LEVEL[overall];
  return (
    <Card id="health" className="mb-4 overflow-hidden" data-testid="health-center" data-level={overall}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:px-5">
        <span className={cn("relative grid h-10 w-10 place-items-center rounded-2xl bg-elevated", O.cls)}>
          <Activity className="h-5 w-5" aria-hidden />
          {overall === "ok" ? <span className="absolute inset-0 animate-ping rounded-2xl bg-success/20 [animation-duration:2.6s]" aria-hidden /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{t("health.title")}</h2>
          <p className="text-[12.5px] text-muted">{t(`health.overall.${overall}`)}</p>
        </div>
      </div>
      <ul className="stagger grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const L = LEVEL[r.level];
          return (
            <li key={r.id} className="flex items-start gap-3 bg-surface p-4" data-health={r.level}>
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", L.dot)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <L.icon className={cn("h-4 w-4", L.cls)} aria-hidden />
                  {t(`campaigns.channels.${r.kind}`)}
                  {r.name ? <span className="truncate text-[12px] font-normal text-muted">· {r.name}</span> : null}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted">{t(`health.reason.${r.reason}`, { n: String(r.failed24h) })}</p>
                <p className="mt-0.5 text-[12px] text-muted">{t("health.lastIn", { when: fmt(r.lastInboundAt) })}</p>
                {r.level === "error" || r.level === "warning" ? (
                  <Link href={`/${locale}/integrations#${r.kind === "whatsapp" || r.kind === "whatsapp_qr" ? "whatsapp" : "connect"}`} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
                    <PlugZap className="h-3.5 w-3.5" aria-hidden /> {t("health.fix")}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
