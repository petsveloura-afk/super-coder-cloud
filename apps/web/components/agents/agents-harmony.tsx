import { Bot, Handshake, MessageSquareText, ShieldCheck, Users, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/format";
import { Badge, Card } from "@/components/ui/primitives";
import { harmonyScore, ownerLabel } from "@/lib/coordination/core";
import type { Locale } from "@/lib/i18n/config";

interface Overview {
  active: { entity_type: string; entity_id: string; lane: string; owner: string; note: string | null; until: string; blocked: number; name: string | null }[];
  active_count: number;
  prevented_7d: number;
  by_owner: Record<string, number>;
}

/**
 * Agent coordination board (additive) — every agent of the business on one page: which customer is handled by whom right now,
 * how many double messages / double tasks were avoided this week, and what all the agents share (one memory of the business, one
 * conversation guard, one claims board). Shown on the smart team and on my team.
 */
export async function AgentsHarmony({ locale, orgId }: { locale: Locale; orgId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_coordination_overview", { p_org: orgId });
  // migration not applied yet → the card does not show (nothing else changes)
  if (error) return null;
  const { t } = await getT(locale);
  const o = (data ?? { active: [], active_count: 0, prevented_7d: 0, by_owner: {} }) as Overview;
  const score = harmonyScore({ active: Number(o.active_count), prevented7d: Number(o.prevented_7d) });
  const lang = locale === "en" || locale === "ar" ? locale : "he";
  const systems = [
    { key: "conversation", icon: MessageSquareText },
    { key: "smart", icon: Bot },
    { key: "team", icon: Users },
    { key: "operator", icon: Workflow },
  ] as const;
  return (
    <Card className="mb-4 overflow-hidden" data-testid="agents-harmony">
      <div className="flex flex-wrap items-start gap-3 border-b border-line p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Handshake className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("agents.harmony.title")}</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">{t("agents.harmony.subtitle")}</p>
        </div>
        <div className="text-end">
          <p className="text-[12px] text-muted">{t("agents.harmony.score")}</p>
          <p className="text-2xl font-black tabular-nums text-success" data-testid="harmony-score">
            {score}
          </p>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-[12px] text-muted">{t("agents.harmony.active")}</p>
          <p className="text-xl font-bold tabular-nums">{Number(o.active_count)}</p>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-[12px] text-muted">{t("agents.harmony.prevented")}</p>
          <p className="text-xl font-bold tabular-nums">{Number(o.prevented_7d)}</p>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-success" /> {t("agents.harmony.shared")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed">{t("agents.harmony.sharedBody")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {systems.map((s) => (
          <Badge key={s.key} tone="success">
            <s.icon className="h-3.5 w-3.5" /> {t(`agents.harmony.systems.${s.key}`)}
          </Badge>
        ))}
      </div>
      <div className="border-t border-line p-4">
        <h3 className="mb-2 text-[13px] font-semibold">{t("agents.harmony.nowTitle")}</h3>
        {o.active.length === 0 ? (
          <p className="text-[12.5px] text-subtle">{t("agents.harmony.none")}</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {o.active.slice(0, 12).map((a) => (
              <li key={`${a.entity_type}-${a.entity_id}-${a.lane}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-hover/50 px-3 py-2">
                <Badge tone={a.lane === "money" ? "gold" : a.lane === "task" ? "accent" : "teal"}>{t(`agents.harmony.lanes.${a.lane}`)}</Badge>
                <b>{a.name || a.note || "—"}</b>
                <span className="text-muted">· {ownerLabel(a.owner, lang)}</span>
                <span className="ms-auto text-[12px] text-subtle">{t("agents.harmony.until", { date: formatDateTime(locale, a.until) })}</span>
                {a.blocked > 0 ? <span className="text-[12px] text-success">· {t("agents.harmony.avoided", { n: a.blocked })}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
