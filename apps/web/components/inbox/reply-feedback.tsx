"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { rateReplyAction } from "@/app/[locale]/(dashboard)/inbox/feedback-actions";

/** Wave 69 — 👍 / 👎 under an agent's reply. One tap saves it; tapping the other one changes the rating. */
export function ReplyFeedback({ messageId }: { messageId: string }) {
  const { t, locale } = useI18n();
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [pending, start] = useTransition();
  const send = (r: "up" | "down") =>
    start(async () => {
      const res = await rateReplyAction({ locale, messageId, rating: r });
      if (res.error) toast.error(t(res.error));
      else setRating(r);
    });
  const cls = (on: boolean) => `rounded-md p-1 transition hover:bg-surface/60 ${on ? "text-gold" : "text-muted"}`;
  return (
    <div className="mt-1 flex items-center gap-1" role="group" aria-label={t("aiQuality.feedback.label")} data-testid="reply-feedback">
      <button type="button" disabled={pending} aria-pressed={rating === "up"} aria-label={t("aiQuality.feedback.up")} title={t("aiQuality.feedback.up")} className={cls(rating === "up")} onClick={() => send("up")}>
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" disabled={pending} aria-pressed={rating === "down"} aria-label={t("aiQuality.feedback.down")} title={t("aiQuality.feedback.down")} className={cls(rating === "down")} onClick={() => send("down")}>
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
