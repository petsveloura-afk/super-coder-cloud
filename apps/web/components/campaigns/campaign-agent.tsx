"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Textarea } from "@/components/ui/primitives";
import { aiCampaignAgentAction, type AgentSendMode } from "@/app/[locale]/(dashboard)/campaigns/actions";

const EXAMPLES = ["winback", "launch", "event", "feedback"] as const;

/**
 * Wave 39 — campaign agent. One sentence in, a complete DRAFT out (channel, message, audience, send window).
 * It never sends anything: the owner reviews the draft, then launches it from the editor.
 */
export function CampaignAgent({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<AgentSendMode>("off");

  function build() {
    // sending is never a surprise: an explicit, separate confirmation is required for the auto-send modes
    if (mode !== "off" && !window.confirm(t("campaigns.agent.confirmAuto"))) return;
    start(async () => {
      const res = await aiCampaignAgentAction({ locale, goal, autoSend: mode, tzOffsetMin: new Date().getTimezoneOffset() });
      if (res.error || !res.data) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      if (res.data.blocked) toast.warning(t(`campaigns.agent.blocked.${res.data.blocked}`));
      else if (res.data.launched) toast.success(t(res.message ?? "campaigns.ai.agentLaunched", { count: res.data.recipients ?? 0 }), { description: res.data.rationale || undefined });
      else toast.success(t(res.message ?? "campaigns.ai.agentDone"), res.data.rationale ? { description: res.data.rationale } : undefined);
      router.push(`/${locale}/campaigns/${res.data.id}`);
    });
  }

  return (
    <Card className="mb-4 overflow-hidden border-accent/30 bg-accent-soft/30 p-5" data-testid="campaign-agent">
      <div className="flex items-start gap-3">
        <span className="brain-pulse grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-solid text-accent-fg">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("campaigns.agent.title")}</h2>
          {!compact ? <p className="mt-0.5 text-[12.5px] text-subtle">{t("campaigns.agent.hint")}</p> : null}
          <Textarea rows={compact ? 2 : 3} className="mt-3" value={goal} onChange={(e) => setGoal(e.target.value.slice(0, 700))} placeholder={t("campaigns.agent.placeholder")} aria-label={t("campaigns.agent.title")} />
          <fieldset className="mt-3">
            <legend className="mb-1.5 text-[12.5px] font-medium text-muted">{t("campaigns.agent.afterBuild")}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {(["off", "best", "now"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition ${mode === m ? "border-transparent bg-accent-solid text-accent-fg" : "border-line bg-surface text-muted hover:bg-surface-hover"}`}>
                  {t(`campaigns.agent.modes.${m}`)}
                </button>
              ))}
            </div>
            {mode !== "off" ? <p className="mt-1.5 text-[11.5px] text-warning">{t("campaigns.agent.autoWarn")}</p> : null}
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={build} loading={pending} disabled={goal.trim().length < 8} data-testid="agent-build">
              <Sparkles className="h-4 w-4" /> {t(pending ? "campaigns.agent.building" : mode === "off" ? "campaigns.agent.build" : "campaigns.agent.buildAndSend")}
            </Button>
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setGoal(t(`campaigns.agent.examples.${x}`))} className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted hover:bg-surface-hover">
                {t(`campaigns.agent.examplesShort.${x}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-subtle">{t(mode === "off" ? "campaigns.agent.safe" : "campaigns.agent.safeAuto")}</p>
        </div>
      </div>
    </Card>
  );
}
