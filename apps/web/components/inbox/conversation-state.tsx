"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Bot, CalendarClock, CheckCircle2, Clock, ShieldCheck, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { cancelScheduleAction, scheduleMessageAction, setOptOutAction } from "@/app/[locale]/(dashboard)/inbox/guard-actions";

export interface ConversationStateView {
  allowed: boolean;
  reason: string;
  opt_out: boolean;
  ai_mode: string;
  last_customer_at: string | null;
  last_human_at: string | null;
  last_auto_at: string | null;
  consent: boolean | null;
  pending: { id: string; kind: string; run_at: string; body: string; cancel_on_reply: boolean; step: number }[];
  recent: { kind: string; status: string; reason: string | null; at: string }[];
  blocked: { kind: string; reason: string; at: string }[];
}

/** ISO → <input type="datetime-local"> value in the viewer's timezone. */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Conversation guard in the inbox — who owns the conversation, consent, what is
 * planned (follow-ups / scheduled messages, each cancellable) and why an automatic
 * message was not sent. Plus "schedule a message".
 */
export function ConversationStatePanel({ conversationId, state, canReply }: { conversationId: string; state: ConversationStateView; canReply: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3 * 3600_000)));
  const [cancelOnReply, setCancelOnReply] = useState(true);

  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        after?.();
        router.refresh();
      }
    });

  const humanOwns = state.ai_mode === "human";
  const humanLast = state.last_human_at && (!state.last_customer_at || state.last_human_at >= state.last_customer_at);
  return (
    <div className="border-b border-line bg-surface/40 px-3 py-2" data-testid="conversation-state">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Badge tone={humanOwns ? "warning" : "accent"}>
          {humanOwns ? <UserRound className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />} {t(humanOwns ? "guard.ownerHuman" : "guard.ownerAI")}
        </Badge>
        {state.opt_out ? (
          <Badge tone="danger">
            <Ban className="h-3.5 w-3.5" /> {t("guard.optedOut")}
          </Badge>
        ) : (
          <Badge tone="success">
            <ShieldCheck className="h-3.5 w-3.5" /> {t(state.consent ? "guard.consentYes" : "guard.serviceOnly")}
          </Badge>
        )}
        {humanLast ? <Badge tone="neutral">{t("guard.humanAnswered")}</Badge> : null}
        {state.pending.length ? (
          <Badge tone="gold">
            <Clock className="h-3.5 w-3.5" /> {t("guard.pendingCount", { count: state.pending.length })}
          </Badge>
        ) : null}
        <span className="ms-auto flex items-center gap-1">
          {canReply ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="schedule-open">
                <CalendarClock className="h-4 w-4" /> <span className="hidden sm:inline">{t("guard.schedule")}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={pending}
                data-testid="optout-toggle"
                onClick={() => {
                  if (!state.opt_out && !window.confirm(t("guard.confirmOptOut"))) return;
                  run(() => setOptOutAction({ locale, conversationId, optOut: !state.opt_out }));
                }}
              >
                {state.opt_out ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                <span className="hidden sm:inline">{t(state.opt_out ? "guard.markIn" : "guard.markOut")}</span>
              </Button>
            </>
          ) : null}
        </span>
      </div>

      {state.pending.length ? (
        <ul className="mt-1.5 space-y-1" data-testid="pending-list">
          {state.pending.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg bg-gold-soft px-2.5 py-1.5 text-[12.5px]">
              <Clock className="h-3.5 w-3.5 shrink-0 text-gold" />
              <span className="min-w-0 flex-1 truncate" dir="auto">
                <b>{t(`guard.kinds.${p.kind}`, { step: p.step })}</b> · {formatDateTime(locale, p.run_at)}
                {p.body ? ` · ${p.body}` : ""}
                {p.cancel_on_reply ? <span className="text-subtle"> · {t("guard.cancelsOnReply")}</span> : null}
              </span>
              {canReply ? (
                <button type="button" className="rounded p-1 text-muted hover:bg-surface-hover hover:text-danger" aria-label={t("guard.cancel")} onClick={() => run(() => cancelScheduleAction({ locale, id: p.id }))} data-testid="pending-cancel">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.blocked.length || state.recent.some((r) => r.status !== "sent") ? (
        <details className="mt-1 text-[11.5px] text-muted">
          <summary className="cursor-pointer">{t("guard.whyNot")}</summary>
          <ul className="mt-1 space-y-0.5">
            {[...state.blocked.map((b) => ({ k: b.kind, r: b.reason, at: b.at })), ...state.recent.filter((r) => r.status !== "sent").map((r) => ({ k: r.kind, r: r.reason ?? r.status, at: r.at }))]
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 6)
              .map((x, i) => (
                <li key={i}>
                  {formatDateTime(locale, x.at)} · {t(`guard.kinds.${x.k}`, { step: 1 })}: {t(`guard.reasons.${x.r}`)}
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen} title={t("guard.scheduleTitle")} description={t("guard.scheduleHint")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => scheduleMessageAction({ locale, conversationId, body, runAt: new Date(when).toISOString(), cancelOnReply }),
              () => {
                setOpen(false);
                setBody("");
              },
            );
          }}
        >
          <Field label={t("guard.message")} htmlFor="sch-body">
            <Textarea id="sch-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" />
          </Field>
          <Field label={t("guard.when")} htmlFor="sch-when">
            <Input id="sch-when" type="datetime-local" dir="ltr" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[1, 3, 24].map((h) => (
              <Button key={h} type="button" size="sm" variant="secondary" onClick={() => setWhen(localInput(new Date(Date.now() + h * 3600_000)))}>
                {t("guard.inHours", { hours: h })}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={cancelOnReply} onChange={(e) => setCancelOnReply(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" data-testid="schedule-cancel-on-reply" />
            {t("guard.cancelOnReply")}
          </label>
          <p className="text-[12px] text-subtle">{t("guard.scheduleRules")}</p>
          <Button type="submit" loading={pending} disabled={!body.trim()} className="w-full justify-center" data-testid="schedule-submit">
            <CalendarClock className="h-4 w-4" /> {t("guard.scheduleSubmit")}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
