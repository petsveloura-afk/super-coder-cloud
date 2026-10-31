"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { suggestRepliesAction } from "@/app/[locale]/(dashboard)/inbox/copilot-actions";

/**
 * Wave 59 — WhatsApp-style AI suggestion chips above the reply box: one tap → three short answers in the
 * business's voice; tapping a chip puts it in the box to edit and send.
 */
export function ReplySuggestions({ conversationId, disabled }: { conversationId: string; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [chips, setChips] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const load = () =>
    start(async () => {
      const r = await suggestRepliesAction({ locale, conversationId });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "errors.generic"));
      setChips(r.data.replies.slice(0, 3));
    });
  const fill = (text: string) => window.dispatchEvent(new CustomEvent("scc:fill-reply", { detail: { conversationId, text } }));
  if (disabled) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-3 pt-2 [scrollbar-width:none]" data-testid="reply-chips">
      <button type="button" onClick={load} disabled={pending} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gold-soft px-3 py-1 text-[12px] font-semibold text-gold transition hover:brightness-110 disabled:opacity-60" aria-busy={pending}>
        <Sparkles className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden /> {t("inbox.chips.suggest")}
      </button>
      {chips.map((c, i) => (
        <button key={i} type="button" onClick={() => fill(c)} title={c} className="feed-in max-w-[16rem] shrink-0 truncate rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] transition hover:border-accent hover:bg-accent-soft" style={{ animationDelay: `${i * 60}ms` }} dir="auto">
          {c}
        </button>
      ))}
    </div>
  );
}
