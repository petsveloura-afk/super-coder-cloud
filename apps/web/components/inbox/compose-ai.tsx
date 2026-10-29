"use client";

import { useState, useTransition } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Briefcase, CheckCheck, HeartHandshake, Languages, Loader2, Maximize2, Minimize2, Smile, Sparkles, Target, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { rewriteDraftAction } from "@/app/[locale]/(dashboard)/inbox/copilot-actions";
import type { ComposeMode } from "@/lib/inbox/compose-core";
import { cn } from "@/lib/utils";

const GROUPS: { key: string; modes: { mode: ComposeMode; icon: typeof Wand2 }[] }[] = [
  {
    key: "quality",
    modes: [
      { mode: "improve", icon: Wand2 },
      { mode: "fix", icon: CheckCheck },
      { mode: "shorter", icon: Minimize2 },
      { mode: "longer", icon: Maximize2 },
    ],
  },
  {
    key: "tone",
    modes: [
      { mode: "friendlier", icon: Smile },
      { mode: "formal", icon: Briefcase },
      { mode: "persuasive", icon: Target },
      { mode: "empathetic", icon: HeartHandshake },
    ],
  },
  {
    key: "translate",
    modes: [
      { mode: "translate_he", icon: Languages },
      { mode: "translate_en", icon: Languages },
      { mode: "translate_ar", icon: Languages },
    ],
  },
];

/**
 * Wave 50 — "✨ AI" next to the send button: improve, fix, shorten, change the tone or translate the draft.
 * The result replaces the draft in the box (never sent automatically) and one click restores the original.
 */
export function ComposeAi({ conversationId, text, setText, disabled }: { conversationId: string; text: string; setText: (v: string) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [pending, start] = useTransition();
  const [previous, setPrevious] = useState<string | null>(null);
  const empty = !text.trim();

  const run = (mode: ComposeMode) =>
    start(async () => {
      const before = text;
      const r = await rewriteDraftAction({ locale, conversationId, text: before, mode });
      if (r.error) return void toast.error(t(r.error));
      if (r.data?.text) {
        setPrevious(before);
        setText(r.data.text);
        toast.success(t("inbox.ai.done"));
      }
    });

  const undo = () => {
    if (previous === null) return;
    setText(previous);
    setPrevious(null);
  };

  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button
          type="button"
          disabled={disabled || pending}
          aria-label={t("inbox.ai.menu")}
          title={t("inbox.ai.menu")}
          data-testid="compose-ai"
          className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-accent transition hover:bg-accent-soft disabled:opacity-50", pending && "animate-pulse")}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {empty ? <p className="px-2.5 py-2 text-[12.5px] text-muted">{t("inbox.ai.empty")}</p> : null}
          {GROUPS.map((g, gi) => (
            <div key={g.key}>
              {gi > 0 ? <DM.Separator className="my-1 h-px bg-line" /> : null}
              <DM.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`inbox.ai.group.${g.key}`)}</DM.Label>
              {g.modes.map(({ mode, icon: Icon }) => (
                <DM.Item
                  key={mode}
                  disabled={empty}
                  onSelect={() => run(mode)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent-soft"
                >
                  <Icon className="h-4 w-4 text-accent" aria-hidden /> {t(`inbox.ai.mode.${mode}`)}
                </DM.Item>
              ))}
            </div>
          ))}
          {previous !== null ? (
            <>
              <DM.Separator className="my-1 h-px bg-line" />
              <DM.Item onSelect={undo} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium outline-none data-[highlighted]:bg-accent-soft">
                <Undo2 className="h-4 w-4" aria-hidden /> {t("inbox.ai.undo")}
              </DM.Item>
            </>
          ) : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
