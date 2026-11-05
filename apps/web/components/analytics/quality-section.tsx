import { ThumbsUp } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { getT, type resolveLocale } from "@/lib/i18n/server";
import { loadFeedback, loadResolution } from "@/lib/ai/resolution";

/**
 * Wave 69 — "agent quality" card on the analytics screen: tickets closed without a person, tickets where the customer asked the
 * same thing again, and the 👍/👎 on the agent's replies. Read-only, from data that already exists; any failure = no card.
 */
export async function QualitySection({ orgId, locale, days }: { orgId: string; locale: Awaited<ReturnType<typeof resolveLocale>>; days: number }) {
  try {
    const { t } = await getT(locale);
    const [res, fb] = await Promise.all([loadResolution(orgId, days), loadFeedback(orgId, days)]);
    if (!res || (res.aiConversations === 0 && !fb?.total)) return null;
    const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
    return (
      <Card className="mb-4 space-y-3 p-5" data-testid="quality-card">
        <div className="flex flex-wrap items-center gap-3">
          <ThumbsUp className="h-5 w-5 text-muted" aria-hidden />
          <h3 className="min-w-0 flex-1 font-bold">{t("aiQuality.card.title")}</h3>
          <span className="text-[12px] text-muted">{t("aiQuality.card.window", { days })}</span>
        </div>
        {res.aiConversations < 5 ? (
          <p className="text-[12.5px] text-muted">{t("aiQuality.card.notEnough")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-2xl font-bold">{pct(res.closedRate)}</p>
              <p className="text-[12.5px] text-muted">{t("aiQuality.card.closedAlone")}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{pct(res.repeatRate)}</p>
              <p className="text-[12.5px] text-muted">{t("aiQuality.card.repeat")}</p>
            </div>
          </div>
        )}
        {res.aiConversations > 0 ? <p className="text-[12px] text-muted">{t("aiQuality.card.ofConvs", { n: res.aiConversations })}</p> : null}
        {fb && fb.total > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold">{t("aiQuality.card.rating")}</span>
            <Badge tone={fb.down > fb.up ? "danger" : "success"}>{t("aiQuality.card.ratingLine", { up: fb.up, down: fb.down })}</Badge>
          </div>
        ) : null}
      </Card>
    );
  } catch {
    return null;
  }
}
