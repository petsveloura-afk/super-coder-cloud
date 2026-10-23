import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { measureSpeed } from "@/lib/admin/speed";
import { latencyLabel } from "@/lib/ai/speed-core";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

/**
 * Speed upgrade — platform admin: where the app runs, how far the database is (3 round trips)
 * and the agent's real reply times over the last 24h (p50 / p90 from message timings).
 * A database far from the app region adds this delay to every step of every reply.
 */
export async function SpeedCard({ locale }: { locale: Locale }) {
  const { t } = await getT(locale);
  const { db, totals, p50, p90, region, supa } = await measureSpeed();
  const slow = db > 60;
  return (
    <Card className="p-5" data-testid="speed-card">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Gauge className="h-4 w-4" /> {t("speed.title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("speed.subtitle")}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-muted">{t("speed.region")}</dt>
          <dd className="mt-1 font-mono text-sm" dir="ltr">{region}</dd>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-muted">{t("speed.db")}</dt>
          <dd className={`mt-1 font-mono text-sm ${slow ? "text-danger" : ""}`} dir="ltr" data-testid="speed-db">{latencyLabel(db)}</dd>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-muted">{t("speed.p50")}</dt>
          <dd className="mt-1 font-mono text-sm" dir="ltr">{latencyLabel(p50) ?? "—"}</dd>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-muted">{t("speed.p90")}</dt>
          <dd className="mt-1 font-mono text-sm" dir="ltr">{latencyLabel(p90) ?? "—"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-subtle" dir="auto">
        {t("speed.replies", { count: String(totals) })} · <span dir="ltr">{supa}</span>
      </p>
      {slow ? <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" data-testid="speed-warning">{t("speed.farDb")}</p> : null}
    </Card>
  );
}
