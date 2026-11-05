"use client";

import { useState } from "react";
import { CalendarHeart, Crown, Gift, Megaphone, PartyPopper, RefreshCw, Rocket, Star, Timer, UserPlus, BellRing, FilePlus2, LayoutTemplate } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { PLAYBOOKS, playbook, playbookValue, type PlaybookId } from "@/lib/campaigns/templates";
import { CampaignEditor, type CampaignValue } from "./campaign-editor";

/**
 * "New campaign" with ready playbooks (welcome, win-back, flash sale, holiday, event, review request, re-engage,
 * launch, reminder, VIP): one click fills the editor with a professional message, the best channel and a fitting
 * audience — everything stays editable. "Blank" keeps today's empty editor.
 */
const ICONS: Record<PlaybookId, typeof Gift> = { welcome: UserPlus, winback: RefreshCw, flash: Timer, holiday: Gift, event: PartyPopper, review: Star, reactivate: Megaphone, launch: Rocket, reminder: BellRing, vip: Crown };
const TINT: Record<PlaybookId, string> = {
  welcome: "from-sky-500 to-indigo-500",
  winback: "from-emerald-500 to-teal-500",
  flash: "from-rose-500 to-orange-500",
  holiday: "from-amber-500 to-pink-500",
  event: "from-fuchsia-500 to-purple-600",
  review: "from-yellow-400 to-amber-500",
  reactivate: "from-cyan-500 to-blue-600",
  launch: "from-violet-500 to-indigo-600",
  reminder: "from-slate-500 to-slate-700",
  vip: "from-amber-400 to-yellow-600",
};

export function PlaybookGallery({ selected, onPick }: { selected: string | null; onPick: (id: PlaybookId | null) => void }) {
  const { t } = useI18n();
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-4" data-testid="campaign-playbooks">
      <div className="mb-3 flex items-center gap-2">
        <LayoutTemplate className="h-4 w-4 text-accent" />
        <h2 className="text-[14px] font-semibold">{t("campaigns.playbooks.title")}</h2>
        <span className="text-[12px] text-muted">{t("campaigns.playbooks.hint")}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <button type="button" onClick={() => onPick(null)} aria-pressed={selected === null} className={cn("group flex flex-col items-start gap-2 rounded-xl border p-3 text-start transition", selected === null ? "border-accent bg-accent-soft" : "border-line hover:-translate-y-0.5 hover:border-accent hover:shadow-sm")}>
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-dashed border-line-strong text-muted">
            <FilePlus2 className="h-4 w-4" />
          </span>
          <span className="text-[12.5px] font-semibold leading-tight">{t("campaigns.playbooks.blank")}</span>
          <span className="text-[11px] text-muted">{t("campaigns.playbooks.blankHint")}</span>
        </button>
        {PLAYBOOKS.map((p) => {
          const Icon = ICONS[p.id];
          const on = selected === p.id;
          return (
            <button key={p.id} type="button" onClick={() => onPick(p.id)} aria-pressed={on} data-testid={`playbook-${p.id}`} className={cn("group flex flex-col items-start gap-2 rounded-xl border p-3 text-start transition", on ? "border-accent bg-accent-soft" : "border-line hover:-translate-y-0.5 hover:border-accent hover:shadow-sm")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm", TINT[p.id])}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[12.5px] font-semibold leading-tight">{t(`campaigns.playbooks.items.${p.id}`)}</span>
              <span className="flex flex-wrap gap-1 text-[10.5px] text-muted">
                <span className="rounded-full bg-surface-hover px-1.5 py-0.5">{t(`campaigns.channels.${p.channel}`)}</span>
                {p.when !== "any" ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-hover px-1.5 py-0.5">
                    <CalendarHeart className="h-2.5 w-2.5" /> {t(`campaigns.playbooks.when.${p.when}`)}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function NewCampaignWorkspace({ tags, channelsReady, initialPlaybook }: { tags: string[]; channelsReady: Record<string, boolean>; initialPlaybook?: string | null }) {
  const { locale } = useI18n();
  const [picked, setPicked] = useState<PlaybookId | null>(playbook(initialPlaybook)?.id ?? null);
  const p = playbook(picked);
  const initial: CampaignValue = p ? (playbookValue(p, locale, channelsReady) as CampaignValue) : { name: "", channel: "email", subject: "", body: "", audience: {} };
  return (
    <>
      <PlaybookGallery selected={picked} onPick={setPicked} />
      <CampaignEditor key={picked ?? "blank"} initial={initial} tags={tags} channelsReady={channelsReady} />
    </>
  );
}
