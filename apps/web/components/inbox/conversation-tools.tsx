"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardList, Lightbulb, Video, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { PaymentLinkButton } from "@/components/finance/finance-plus";
import { applyExtractedFieldsAction, startVideoCallAction, suggestRepliesAction, summarizeConversationAction, type ExtractedFields } from "@/app/[locale]/(dashboard)/inbox/copilot-actions";

/**
 * Wave 15-16 — tools above the reply box:
 *   AI co-pilot (3 suggested replies → into the reply box; summary + details → contact),
 *   payment link, video call.
 */
export function ConversationTools({ conversationId, currency, canAI, canFinance, canWriteContacts }: { conversationId: string; currency: string; canAI: boolean; canFinance: boolean; canWriteContacts: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [replies, setReplies] = useState<string[] | null>(null);
  const [summary, setSummary] = useState<{ summary: string; next_step: string; sentiment: string | null; fields: ExtractedFields; contactId: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (kind: "replies" | "summary" | "video") =>
    start(async () => {
      setBusy(kind);
      try {
        if (kind === "replies") {
          const r = await suggestRepliesAction({ locale, conversationId });
          if (r.error) toast.error(t(r.error));
          else setReplies(r.data?.replies ?? []);
        } else if (kind === "summary") {
          const r = await summarizeConversationAction({ locale, conversationId });
          if (r.error) toast.error(t(r.error));
          else if (r.data) setSummary(r.data);
        } else {
          const r = await startVideoCallAction({ locale, conversationId });
          if (r.error) toast.error(t(r.error));
          else {
            toast.success(t(r.message ?? "video.sent"));
            if (r.data?.url) window.open(r.data.url, "_blank", "noopener,noreferrer");
            router.refresh();
          }
        }
      } finally {
        setBusy(null);
      }
    });

  const fill = (text: string) => {
    window.dispatchEvent(new CustomEvent("scc:fill-reply", { detail: { conversationId, text } }));
    setReplies(null);
  };

  const fieldRows = summary ? (Object.entries(summary.fields) as [keyof ExtractedFields, string][]) : [];

  return (
    <div className="border-t border-line" data-testid="conversation-tools">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        {canAI ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => run("replies")} loading={pending && busy === "replies"} data-testid="copilot-suggest">
              <Lightbulb className="h-4 w-4 text-gold" /> {t("copilot.suggest")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => run("summary")} loading={pending && busy === "summary"} data-testid="copilot-summary">
              <ClipboardList className="h-4 w-4" /> {t("copilot.summarize")}
            </Button>
          </>
        ) : null}
        {canFinance ? <PaymentLinkButton conversationId={conversationId} currency={currency} /> : null}
        <Button variant="ghost" size="sm" onClick={() => run("video")} loading={pending && busy === "video"} data-testid="video-call">
          <Video className="h-4 w-4" /> <span className="hidden sm:inline">{t("video.button")}</span>
        </Button>
      </div>

      {replies?.length ? (
        <ul className="space-y-1.5 px-3 pt-2" aria-label={t("copilot.suggestions")} data-testid="copilot-replies">
          {replies.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => fill(r)} className="flex w-full items-start gap-2 rounded-xl border border-gold/30 bg-gold-soft px-3 py-2 text-start text-[13.5px] hover:border-gold" dir="auto">
                <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                <span className="whitespace-pre-wrap">{r}</span>
              </button>
            </li>
          ))}
          <li className="text-[11.5px] text-subtle">{t("copilot.clickToUse")}</li>
        </ul>
      ) : null}

      <Dialog open={Boolean(summary)} onOpenChange={(o) => !o && setSummary(null)} title={t("copilot.summaryTitle")} className="sm:max-w-lg">
        {summary ? (
          <div className="space-y-4" data-testid="copilot-summary-dialog">
            <p className="whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
              {summary.summary}
            </p>
            {summary.next_step ? (
              <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px]">
                <span className="font-semibold">{t("copilot.nextStep")}: </span>
                {summary.next_step}
              </p>
            ) : null}
            {summary.sentiment ? <Badge tone={summary.sentiment === "positive" ? "success" : summary.sentiment === "negative" ? "danger" : "neutral"}>{t(`insights.sentiment.${summary.sentiment}`)}</Badge> : null}
            {fieldRows.length ? (
              <dl className="divide-y divide-line rounded-xl border border-line text-[13px]">
                {fieldRows.map(([k, v]) => (
                  <div key={k} className="flex gap-3 px-3 py-2">
                    <dt className="w-24 shrink-0 text-muted">{t(`copilot.fields.${k}`)}</dt>
                    <dd className="min-w-0 break-words" dir="auto">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-subtle">{t("copilot.noFields")}</p>
            )}
            {summary.contactId && canWriteContacts ? (
              <Button
                onClick={() =>
                  start(async () => {
                    const r = await applyExtractedFieldsAction({ locale, contactId: summary.contactId!, fields: summary.fields, summary: summary.summary });
                    if (r.error) toast.error(t(r.error));
                    else {
                      toast.success(t(r.message ?? "common.saved"));
                      setSummary(null);
                      router.refresh();
                    }
                  })
                }
                loading={pending}
                data-testid="copilot-apply"
              >
                <Check className="h-4 w-4" /> {t("copilot.apply")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
