import { Flame, Hand, Handshake, MessagesSquare, Sparkles, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";

/** "How the agent performed" — last 30 days (server component, RLS-scoped counts). */
export async function AgentStats({ orgId, locale }: { orgId: string; locale: Locale }) {
  const supabase = await createClient();
  const { t } = await getT(locale);
  const since = new Date(new Date().getTime() - 30 * 86_400_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [replies, convs, leads, hot, handoffs, deals] = await Promise.all([
    count(supabase.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).not("ai_agent_id", "is", null).gte("created_at", since)),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("last_ai_at", since)),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("lead_at", since)),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("lead_score", "hot").gte("lead_at", since)),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("handoff_at", since)),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).not("deal_id", "is", null).gte("lead_at", since)),
  ]);
  const items = [
    { icon: MessagesSquare, label: t("ai.stats.conversations"), value: convs },
    { icon: Sparkles, label: t("ai.stats.replies"), value: replies },
    { icon: UserPlus, label: t("ai.stats.leads"), value: leads },
    { icon: Flame, label: t("ai.stats.hot"), value: hot },
    { icon: Handshake, label: t("ai.stats.deals"), value: deals },
    { icon: Hand, label: t("ai.stats.handoffs"), value: handoffs },
  ];
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4" data-testid="agent-stats">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("ai.stats.title")}</h2>
        <span className="text-[12px] text-subtle">{t("ai.stats.period")}</span>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((it) => (
          <li key={it.label} className="rounded-xl bg-elevated p-3">
            <it.icon className="mb-1.5 h-4 w-4 text-accent" />
            <div className="text-xl font-bold tabular-nums">{formatNumber(locale, it.value)}</div>
            <div className="text-[12px] text-muted">{it.label}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
