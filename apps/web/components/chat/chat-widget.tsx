"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, UserRound, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Website chat bubble — talks to the business's AI agent (no setup needed).
 * Shown on published sites, the help portal and the embeddable /chat/{org}
 * page (used by /widget.js on any external website).
 */

interface ChatMsg {
  id: string;
  from: "me" | "agent" | "team";
  text: string;
  at: string;
  pending?: boolean;
  buttons?: string[];
  askPhone?: boolean;
}

interface ChatState {
  enabled: boolean;
  org: string;
  agent: string;
  greeting: string;
  mode: string | null;
  messages: ChatMsg[];
}

function visitorId(org: string): string {
  const key = `scc_chat_${org}`;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved && /^[a-f0-9]{32,64}$/.test(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    window.localStorage.setItem(key, id);
  } catch {
    /* storage blocked: this tab only */
  }
  return id;
}

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-medium underline underline-offset-2">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ChatWidget({ orgSlug, accent, embedded = false, defaultOpen = false }: { orgSlug: string; accent?: string; embedded?: boolean; defaultOpen?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [state, setState] = useState<ChatState | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState({ name: "", phone: "" });
  const vid = useRef<string>("");
  const queued = useRef<{ extra?: { name?: string; phone?: string }; override?: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const color = /^#[0-9a-f]{6}$/i.test(accent ?? "") ? accent! : "#3366E6";

  useEffect(() => {
    vid.current = visitorId(orgSlug);
    let alive = true;
    fetch(`/api/chat/${orgSlug}?v=${vid.current}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && setState(s as ChatState | null))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [orgSlug]);

  // while open: pick up replies from the team (and late AI answers)
  useEffect(() => {
    if (!open || !state?.enabled) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible" || busy) return;
      const r = await fetch(`/api/chat/${orgSlug}?v=${vid.current}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setState((await r.json()) as ChatState);
    }, 5000);
    return () => clearInterval(id);
  }, [open, state?.enabled, orgSlug, busy]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.messages.length, busy, open]);

  useEffect(() => {
    if (!busy && queued.current) {
      const q = queued.current;
      queued.current = null;
      void send(q.extra, q.override);
    }
    // flush once when the previous reply finished (send is recreated every render on purpose)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  if (!state?.enabled) {
    return embedded ? <p className="p-6 text-center text-sm text-muted">{t("chat.unavailable")}</p> : null;
  }

  async function send(extra?: { name?: string; phone?: string }, override?: string) {
    const body = (override ?? text).trim();
    if (!body) return;
    // typed while the agent is still answering → sent automatically right after
    if (busy) {
      queued.current = { extra, override };
      return;
    }
    setBusy(true);
    setError(null);
    if (override === undefined) setText("");
    const optimistic: ChatMsg = { id: `tmp-${new Date().getTime()}`, from: "me", text: body, at: new Date().toISOString(), pending: true };
    setState((s) => (s ? { ...s, messages: [...s.messages, optimistic] } : s));
    try {
      const r = await fetch(`/api/chat/${orgSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: vid.current, text: body, ...(extra?.name ? { name: extra.name } : {}), ...(extra?.phone ? { phone: extra.phone } : {}) }),
      });
      if (r.status === 429) throw new Error("rate");
      if (!r.ok) throw new Error("failed");
      setState((await r.json()) as ChatState);
    } catch (e) {
      setError((e as Error).message === "rate" ? t("chat.slowDown") : t("chat.failed"));
      setState((s) => (s ? { ...s, messages: s.messages.filter((m) => m.id !== optimistic.id) } : s));
      setText(body);
    } finally {
      setBusy(false);
    }
  }

  const greeting = state.greeting || t("chat.defaultGreeting", { org: state.org });
  const last = state.messages[state.messages.length - 1];
  const wantPhone = Boolean(last?.from === "agent" && last.askPhone);
  const panel = (
    <section
      className={cn(
        "flex flex-col overflow-hidden bg-surface text-fg",
        embedded ? "h-dvh w-full" : "fixed bottom-24 end-4 z-50 h-[min(620px,calc(100dvh-8rem))] w-[min(390px,calc(100vw-2rem))] rounded-3xl border border-line shadow-2xl",
      )}
      role="dialog"
      aria-label={t("chat.title")}
      data-testid="chat-panel"
    >
      <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <div className="grid h-10 w-10 place-items-center rounded-full bg-white/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{state.agent || state.org}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-white/85">
            <span className="h-2 w-2 rounded-full bg-emerald-300" /> {state.mode === "human" ? t("chat.teamOnline") : t("chat.online")}
          </div>
        </div>
        {!embedded ? (
          <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="rounded-full p-1.5 hover:bg-white/15">
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </header>

      <div ref={logRef} className="flex-1 space-y-2.5 overflow-y-auto bg-elevated/40 p-4" data-testid="chat-log-public" aria-live="polite">
        <Bubble from="agent" color={color}>
          <Linkified text={greeting} />
        </Bubble>
        {state.messages.map((m) => (
          <Bubble key={m.id} from={m.from} color={color} pending={m.pending} label={m.from === "team" ? t("chat.team") : undefined}>
            <Linkified text={m.text} />
          </Bubble>
        ))}
        {!busy && last?.from === "agent" && last.buttons?.length ? (
          <div className="flex flex-wrap justify-start gap-2" data-testid="chat-quick-replies">
            {last.buttons.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => void send(undefined, b)}
                className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition hover:text-white"
                style={{ borderColor: color, color }}
                onMouseEnter={(e) => (e.currentTarget.style.background = color)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {b}
              </button>
            ))}
          </div>
        ) : null}
        {busy ? (
          <div className="flex justify-start" data-testid="chat-typing">
            <div className="flex gap-1 rounded-2xl rounded-ss-md bg-surface px-4 py-3 shadow-sm">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-subtle" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {showDetails || wantPhone ? (
        <form
          className="grid gap-2 border-t border-line bg-surface p-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!details.name.trim() && !details.phone.trim()) return;
            const msg = t("chat.detailsMessage", { name: details.name, phone: details.phone });
            setShowDetails(false);
            // the agent asked for the phone → send the details right away
            if (wantPhone) void send(details, msg);
            else setText((x) => x || msg);
          }}
        >
          <input aria-label={t("chat.name")} placeholder={t("chat.name")} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} className="h-9 rounded-xl border border-line bg-elevated px-3 text-sm outline-none focus:border-accent" />
          <input aria-label={t("chat.phone")} placeholder={t("chat.phone")} dir="ltr" inputMode="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} className="h-9 rounded-xl border border-line bg-elevated px-3 text-sm outline-none focus:border-accent" />
          <button type="submit" className="h-9 rounded-xl px-3 text-sm font-medium text-white" style={{ background: color }}>
            {t("chat.add")}
          </button>
        </form>
      ) : null}

      <div className="border-t border-line bg-surface p-3">
        {error ? <p className="mb-2 text-[12px] text-danger">{error}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            aria-label={t("chat.placeholder")}
            placeholder={t("chat.placeholder")}
            value={text}
            rows={1}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(details.name || details.phone ? details : undefined);
              }
            }}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-elevated px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            dir="auto"
          />
          <button
            type="button"
            onClick={() => void send(details.name || details.phone ? details : undefined)}
            disabled={busy || !text.trim()}
            aria-label={t("chat.send")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-md transition disabled:opacity-40"
            style={{ background: color }}
          >
            <Send className="h-4.5 w-4.5 rtl:-scale-x-100" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-subtle">
          <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setShowDetails((x) => !x)}>
            <UserRound className="h-3.5 w-3.5" /> {t("chat.leaveDetails")}
          </button>
          <span>
            {t("chat.poweredBy")} <span dir="ltr">Super Coder</span>
          </span>
        </div>
      </div>
    </section>
  );

  if (embedded) return <div dir={locale === "en" ? "ltr" : "rtl"}>{panel}</div>;
  return (
    <>
      {open ? panel : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? t("common.close") : t("chat.open")}
        aria-expanded={open}
        data-testid="chat-launcher"
        className="fixed bottom-5 end-4 z-50 grid h-14 w-14 place-items-center rounded-full text-white shadow-xl transition hover:scale-105"
        style={{ background: color }}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}

function Bubble({ from, color, pending, label, children }: { from: ChatMsg["from"]; color: string; pending?: boolean; label?: string; children: React.ReactNode }) {
  const mine = from === "me";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")} data-from={from}>
      <div
        className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm", mine ? "rounded-se-md text-white" : "rounded-ss-md bg-surface", pending && "opacity-70")}
        style={mine ? { background: color } : undefined}
        dir="auto"
      >
        {label ? <div className="mb-0.5 text-[11px] font-semibold text-accent">{label}</div> : null}
        {children}
      </div>
    </div>
  );
}
