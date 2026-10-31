import Link from "next/link";
import { Bot, CheckCircle2, Globe2, MessageCircle, Plug, Smartphone, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { quickStartProgress, quickStartSteps, ringDash, type QuickStepKey } from "@/lib/dashboard/quickstart-core";

const ICON: Record<QuickStepKey, typeof Bot> = { agent: Bot, site: Globe2, channel: Plug, test: MessageCircle, app: Smartphone };

/**
 * Wave 59 — "ready in 3 minutes": the five steps from sign-up to an agent that answers customers, with a
 * progress ring. Disappears by itself when everything is done.
 */
export async function QuickStart({ orgId, userId, locale }: { orgId: string; userId: string; locale: "he" | "en" | "ar" }) {
  const supabase = await createClient();
  const [{ data: agents }, { count: channels }, { count: convs }, { count: push }] = await Promise.all([
    supabase.from("ai_agents").select("id, profile").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(5),
    supabase.from("channel_accounts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  const list = (agents ?? []) as { id: string; profile: Record<string, unknown> | null }[];
  const knows = list.some((a) => ["services", "business", "faq", "website"].some((k) => String(a.profile?.[k] ?? "").trim().length > 3));
  const steps = quickStartSteps({ hasAgent: list.length > 0, knowsBusiness: knows, hasChannel: (channels ?? 0) > 0, tested: (convs ?? 0) > 0, appReady: (push ?? 0) > 0 });
  const prog = quickStartProgress(steps);
  if (prog.complete) return null;
  const { t } = await getT(locale);
  const ring = ringDash(prog.pct);
  const agentId = list[0]?.id ?? null;
  const href: Record<QuickStepKey, string> = {
    agent: `/${locale}/ai-agents`,
    site: agentId ? `/${locale}/ai-agents/${agentId}/setup#site-import` : `/${locale}/ai-agents`,
    channel: `/${locale}/integrations`,
    test: `/${locale}/ai-agents`,
    app: `/${locale}/settings#push`,
  };
  return (
    <Card className="mb-4 overflow-hidden bento-glow" data-testid="quick-start">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <svg width="64" height="64" viewBox="0 0 56 56" className="shrink-0 -rotate-90" role="img" aria-label={t("quickStart.progress", { done: String(prog.done), total: String(prog.total) })}>
          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="6" className="stroke-line" />
          <circle cx="28" cy="28" r="22" fill="none" strokeWidth="6" strokeLinecap="round" className="ring-fill stroke-accent-solid" style={{ strokeDasharray: ring.circumference, strokeDashoffset: ring.offset, ["--ring-c" as string]: ring.circumference }} />
          <text x="28" y="33" textAnchor="middle" className="rotate-90 fill-current text-[13px] font-bold" style={{ transformOrigin: "28px 28px" }}>
            {prog.pct}%
          </text>
        </svg>
        <div className="min-w-[14rem] flex-1">
          <h2 className="flex items-center gap-2 text-[17px] font-bold">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden /> {t("quickStart.title")}
          </h2>
          <p className="text-[13px] text-muted">{t("quickStart.subtitle")}</p>
        </div>
      </div>
      <ol className="stagger grid gap-px border-t border-line bg-line sm:grid-cols-5">
        {steps.map((s, i) => {
          const Icon = ICON[s.key];
          const next = prog.next === s.key;
          return (
            <li key={s.key} className={cn("bg-surface", next && "ring-2 ring-inset ring-accent/50")}>
              <Link href={href[s.key]} className="flex h-full items-start gap-2.5 p-3.5 transition hover:bg-surface-hover" data-quick={s.key} data-done={s.done ? "1" : "0"}>
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold", s.done ? "bg-success text-white" : next ? "bg-accent-solid text-accent-fg" : "bg-elevated text-muted")}>
                  {s.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("flex items-center gap-1 text-[13px] font-semibold", s.done && "text-muted line-through")}>
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> {t(`quickStart.steps.${s.key}.title`)}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t(`quickStart.steps.${s.key}.body`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
