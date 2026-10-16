"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ExternalLink, Globe, ImageIcon, Lock, MessageSquarePlus, Pencil, RotateCcw, Send, Sparkles, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Select } from "@/components/ui/primitives";
import { Markdown } from "@/components/ai/markdown";
import type { AgentRow } from "@/components/ai/agents-client";
import {
  deleteConversationAction,
  listConversationsAction,
  loadConversationAction,
  sendAgentMessageAction,
  type ChatMessage,
  type ConversationSummary,
} from "@/app/[locale]/(dashboard)/ai-agents/chat-actions";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["ai.suggest1", "ai.suggest2", "ai.suggest3"] as const;

/**
 * AI studio chat: saved conversations, optimistic sending with a typing indicator,
 * Markdown answers, and inline cards for websites the agent built.
 */
export function StudioChat({ agents, caps }: { agents: AgentRow[]; caps: { full: boolean; images: boolean; canBuild: boolean } }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const usable = agents.filter((a) => a.enabled);
  const [selected, setSelected] = useState(usable[0]?.id ?? "");
  const agentId = usable.some((a) => a.id === selected) ? selected : (usable[0]?.id ?? "");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState<{ text: string; error: string } | null>(null);
  const [sending, startSend] = useTransition();
  const [loading, startLoad] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshList = (id: string) =>
    listConversationsAction({ locale, agentId: id }).then((r) => {
      if (r.ok) setConversations(r.data);
    });

  // load the conversation list whenever the agent changes
  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    listConversationsAction({ locale, agentId }).then((r) => {
      if (alive && r.ok) setConversations(r.data);
    });
    return () => {
      alive = false;
    };
  }, [agentId, locale]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  function openConversation(id: string | null) {
    setFailed(null);
    setConversationId(id);
    if (!id) {
      setMessages([]);
      inputRef.current?.focus();
      return;
    }
    startLoad(async () => {
      const r = await loadConversationAction({ locale, conversationId: id });
      if (r.ok) setMessages(r.data);
      else toast.error(t(r.error));
    });
  }

  function send(text: string) {
    const message = text.trim();
    if (!message || !agentId || sending) return;
    setFailed(null);
    setDraft("");
    const optimistic: ChatMessage = { role: "user", content: message };
    setMessages((m) => [...m, optimistic]);
    startSend(async () => {
      const r = await sendAgentMessageAction({ locale, agentId, conversationId, message });
      if (!r.ok) {
        setMessages((m) => m.filter((x) => x !== optimistic));
        setFailed({ text: message, error: r.error });
        setDraft(message);
        return;
      }
      setMessages((m) => [...m.filter((x) => x !== optimistic), r.data.user, r.data.assistant]);
      if (r.data.conversationId !== conversationId) setConversationId(r.data.conversationId);
      if (r.data.assistant.meta?.site) toast.success(t("ai.siteBuilt"));
      void refreshList(agentId);
      router.refresh(); // credits meter
    });
  }

  if (usable.length === 0) return <p className="text-sm text-subtle">{t("ai.noEnabledAgents")}</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
      {/* conversations */}
      <aside className="flex flex-col gap-2">
        <Select
          aria-label={t("ai.agent")}
          value={agentId}
          onChange={(e) => {
            setSelected(e.target.value);
            setConversations([]);
            openConversation(null);
          }}
          className="h-10"
        >
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => openConversation(null)} className="justify-center">
          <MessageSquarePlus className="h-4 w-4" /> {t("ai.newChat")}
        </Button>
        <ul className="max-h-48 space-y-1 overflow-y-auto lg:max-h-[440px]" aria-label={t("ai.conversations")}>
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => openConversation(c.id)}
                className={cn("min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-start text-[13px]", c.id === conversationId ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-hover")}
                data-conversation-item
              >
                {c.title || t("ai.untitled")}
              </button>
              <button
                type="button"
                aria-label={t("common.delete")}
                className="rounded-md p-1.5 text-subtle opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                onClick={async () => {
                  if (!window.confirm(t("ai.deleteChatConfirm"))) return;
                  const r = await deleteConversationAction({ locale, conversationId: c.id });
                  if (!r.ok) return toast.error(t(r.error));
                  setConversations((l) => l.filter((x) => x.id !== c.id));
                  if (c.id === conversationId) openConversation(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          {caps.canBuild ? <Badge tone="accent">{t(caps.full ? "ai.capFullSite" : "ai.capLanding")}</Badge> : null}
          {caps.images ? (
            <Badge tone="gold">
              <ImageIcon className="h-3 w-3" /> {t("ai.capImages")}
            </Badge>
          ) : (
            <Link href={`/${locale}/billing`} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-subtle hover:text-fg">
              <Lock className="h-3 w-3" /> {t("ai.capUpgrade")}
            </Link>
          )}
        </div>
      </aside>

      {/* messages */}
      <section className="flex min-h-[460px] flex-col rounded-2xl border border-line bg-elevated">
        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-busy={sending || loading} data-testid="chat-log">
          {messages.length === 0 && !loading ? (
            <div className="grid h-full place-items-center py-10 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gold-soft text-gold">
                  <Sparkles className="h-6 w-6" />
                </span>
                <p className="mt-3 text-sm text-subtle">{t("ai.chatEmpty")}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((k) => (
                    <button key={k} type="button" onClick={() => send(t(k))} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] hover:border-accent hover:text-accent">
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={m.id ?? `o${i}`} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "")} data-role={m.role}>
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-accent-solid text-accent-fg" : "bg-gold-soft text-gold")}>
                {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </span>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] shadow-sm", m.role === "user" ? "rounded-tr-sm bg-accent-solid text-accent-fg rtl:rounded-tl-sm rtl:rounded-tr-2xl" : "rounded-tl-sm border border-line bg-surface rtl:rounded-tl-2xl rtl:rounded-tr-sm")}>
                {m.role === "assistant" ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap leading-7" dir="auto">{m.content}</p>}
                {m.meta?.site ? <SiteCard site={m.meta.site} /> : null}
                {m.meta?.siteError ? <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{t(m.meta.siteError)}</p> : null}
                {m.role === "assistant" ? (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-subtle">
                    <Sparkles className="h-3 w-3" /> {t("ai.aiNotice")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="flex gap-2.5" data-testid="typing">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-soft text-gold">
                <Bot className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface px-4 py-3" aria-label={t("ai.typing")}>
                {[0, 1, 2].map((d) => (
                  <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-subtle" style={{ animationDelay: `${d * 150}ms` }} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {failed ? (
          <div role="alert" className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <span className="flex-1">{t(failed.error)}</span>
            <Button size="sm" variant="ghost" onClick={() => send(failed.text)}>
              <RotateCcw className="h-3.5 w-3.5" /> {t("common.retry")}
            </Button>
          </div>
        ) : null}
        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            maxLength={4000}
            placeholder={t("ai.messagePlaceholder")}
            aria-label={t("ai.messagePlaceholder")}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
            dir="auto"
          />
          <Button type="submit" loading={sending} disabled={!draft.trim()} aria-label={t("ai.send")} className="h-10">
            <Send className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </form>
      </section>
    </div>
  );
}

function SiteCard({ site }: { site: NonNullable<ChatMessage["meta"]>["site"] & object }) {
  const { t, locale } = useI18n();
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-accent/30 bg-accent-soft/40" data-testid="site-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Globe className="h-4 w-4 text-accent" />
        <span className="min-w-0 flex-1 truncate font-semibold">{site.name}</span>
        <Badge tone="neutral">{t(site.mode === "full" ? "ai.siteFull" : "ai.siteLanding")}</Badge>
      </div>
      <p className="px-3 pb-2 text-[12.5px] text-muted">{t("ai.siteDraftHint")}</p>
      {site.downgraded ? <p className="px-3 pb-2 text-[12.5px] text-gold">{t("ai.siteDowngraded")}</p> : null}
      <div className="flex flex-wrap gap-2 border-t border-accent/20 px-3 py-2">
        <Link href={`/${locale}/websites/${site.id}/preview`} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-solid px-3 py-1.5 text-[13px] font-medium text-accent-fg">
          <ExternalLink className="h-3.5 w-3.5" /> {t("ai.sitePreview")}
        </Link>
        <Link href={`/${locale}/websites/${site.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px]">
          <Pencil className="h-3.5 w-3.5" /> {t("ai.siteEdit")}
        </Link>
      </div>
    </div>
  );
}
