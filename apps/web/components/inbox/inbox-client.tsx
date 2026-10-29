"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCheck, MessageCircle, RotateCcw, Send, Smartphone, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Select, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { markReadAction, replyAction, setAiModeAction, startConversationAction, updateConversationAction } from "@/app/[locale]/(dashboard)/inbox/actions";
import { ComposeAi } from "@/components/inbox/compose-ai";

export const CHANNEL_ICON = { whatsapp: MessageCircle, telegram: Send, sms: Smartphone } as const;

/** Refreshes server data every few seconds while the tab is visible (new messages). */
export function LiveRefresh({ ms = 8000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  // wave 43: customers' Facebook / Instagram messages that Meta's webhook did not deliver are fetched every ~20s
  // while the inbox is open (the 5-minute server sweep can run hours late) — never throws, never blocks the page
  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/channels/meta/sync", { method: "POST", cache: "no-store" });
        const j = (await res.json().catch(() => ({}))) as { messages?: number };
        if (!stopped && (j.messages ?? 0) > 0) router.refresh();
      } catch {
        /* offline / signed out: try again later */
      }
    };
    const first = setTimeout(() => void pull(), 1500);
    const id = setInterval(() => void pull(), 20_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [router]);
  return null;
}

export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  const { locale } = useI18n();
  const done = useRef(false);
  useEffect(() => {
    if (unread > 0 && !done.current) {
      done.current = true;
      void markReadAction({ locale, conversationId });
    }
  }, [conversationId, unread, locale]);
  return null;
}

export function ReplyBox({ conversationId, disabled }: { conversationId: string; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  // wave 16: the AI co-pilot puts a suggested reply into the box (the agent edits and sends it)
  useEffect(() => {
    const onFill = (e: Event) => {
      const d = (e as CustomEvent<{ conversationId: string; text: string }>).detail;
      if (d?.conversationId === conversationId && typeof d.text === "string") setText(d.text);
    };
    window.addEventListener("scc:fill-reply", onFill);
    return () => window.removeEventListener("scc:fill-reply", onFill);
  }, [conversationId]);
  function send() {
    if (!text.trim()) return;
    start(async () => {
      const res = await replyAction({ locale, conversationId, text });
      if (res.error) toast.error(t(res.error, res.messageParams));
      else {
        setText("");
        router.refresh();
      }
    });
  }
  return (
    <div className="flex items-end gap-2 border-t border-line p-3">
      <Textarea
        aria-label={t("inbox.reply")}
        placeholder={t("inbox.replyPlaceholder")}
        value={text}
        rows={2}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
        className="min-h-[52px] flex-1 resize-none"
      />
      {/* wave 50 — AI writing tools for the draft */}
      <ComposeAi conversationId={conversationId} text={text} setText={setText} disabled={disabled} />
      <Button onClick={send} loading={pending} disabled={disabled || !text.trim()} aria-label={t("inbox.send")}>
        <Send className="h-4 w-4 rtl:-scale-x-100" /> <span className="hidden sm:inline">{t("inbox.send")}</span>
      </Button>
    </div>
  );
}

export function ConversationControls({ conversationId, status, assigneeId, members }: { conversationId: string; status: string; assigneeId: string | null; members: { id: string; label: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (patch: { status?: "open" | "closed"; assigneeId?: string | null }) =>
    start(async () => {
      const res = await updateConversationAction({ locale, conversationId, ...patch });
      if (res.error) toast.error(t(res.error));
      else toast.success(t(res.message ?? "common.saved"));
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={t("inbox.assignee")} value={assigneeId ?? ""} disabled={pending} onChange={(e) => run({ assigneeId: e.target.value || null })} className="h-8 w-40 text-[13px]">
        <option value="">{t("inbox.unassigned")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </Select>
      {status === "open" ? (
        <Button variant="secondary" size="sm" loading={pending} onClick={() => run({ status: "closed" })}>
          <CheckCheck className="h-4 w-4" /> {t("inbox.close")}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" loading={pending} onClick={() => run({ status: "open" })}>
          <RotateCcw className="h-4 w-4" /> {t("inbox.reopen")}
        </Button>
      )}
    </div>
  );
}

/** Contact page: send a first WhatsApp / Telegram / SMS message. */
export function MessageContactButton({ contactId, channels }: { contactId: string; channels: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(channels[0] ?? "whatsapp");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  if (!channels.length) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("inbox.messageContact")}
      trigger={
        <Button variant="secondary">
          <MessageCircle className="h-4 w-4" /> {t("inbox.message")}
        </Button>
      }
    >
      <div className="space-y-3">
        <Select aria-label={t("campaigns.channel")} value={channel} onChange={(e) => setChannel(e.target.value)}>
          {channels.map((c) => (
            <option key={c} value={c}>
              {t(`campaigns.channels.${c}`)}
            </option>
          ))}
        </Select>
        <Textarea aria-label={t("campaigns.message")} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" /> {t("common.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={!text.trim()}
            onClick={() =>
              start(async () => {
                const res = await startConversationAction({ locale, contactId, channel, text });
                if (res.error) toast.error(t(res.error, res.messageParams));
                else {
                  toast.success(t("inbox.sent"));
                  setOpen(false);
                  setText("");
                  router.refresh();
                }
              })
            }
          >
            <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("inbox.send")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Who answers this conversation: the AI agent (auto) or the team (human). A team reply switches to "human". */
export function AiModeToggle({ conversationId, mode, testId = "ai-mode" }: { conversationId: string; mode: "auto" | "human"; testId?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const auto = mode === "auto";
  return (
    <Button
      variant={auto ? "secondary" : "primary"}
      size="sm"
      loading={pending}
      data-testid={testId}
      data-mode={mode}
      title={t(auto ? "inbox.aiModeAutoHint" : "inbox.aiModeHumanHint")}
      onClick={() =>
        start(async () => {
          const res = await setAiModeAction({ locale, conversationId, mode: auto ? "human" : "auto" });
          if (res.error) toast.error(t(res.error));
          else toast.success(t(auto ? "inbox.aiPaused" : "inbox.aiResumed"));
          router.refresh();
        })
      }
    >
      {auto ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />} {t(auto ? "inbox.takeOver" : "inbox.backToAi")}
    </Button>
  );
}
