import Link from "next/link";
import { latencyLabel } from "@/lib/ai/speed-core";
import { aiNoteKey, resumeInMinutes, type AiNoteKey } from "@/lib/inbox/ai-note";
import { DEFAULT_RESUME_MINUTES } from "@/lib/ai/resume";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Bot, Camera, Globe, Inbox, Mail, MessageCircle, MessagesSquare, Phone, Plug, QrCode, Send, Smartphone, User, UserRound } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AiModeToggle, ConversationControls, LiveRefresh, MarkRead, ReplyBox } from "@/components/inbox/inbox-client";
import { ConversationTools } from "@/components/inbox/conversation-tools";
import { ConversationStatePanel, type ConversationStateView } from "@/components/inbox/conversation-state";
import { SavedReplies } from "@/components/inbox/saved-replies";
import { INBOX_CHANNELS, INBOX_FLAGS, searchTerm, slaTone, waitingMinutes, waitLabel, type InboxChannel, type InboxFlag } from "@/lib/inbox/sla";

// icons resolved on the server (objects exported from client modules are only references here)
const CHANNEL_ICON = { whatsapp: MessageCircle, telegram: Send, sms: Smartphone, whatsapp_qr: QrCode, email: Mail, web: Globe, telegram_user: UserRound, messenger: MessagesSquare, instagram: Camera, voice: Phone } as const;
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { memberOptions } from "@/lib/lookups";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("inbox.title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const FILTERS = ["open", "mine", "unassigned", "closed"] as const;

interface ConvRow {
  id: string;
  channel: "whatsapp" | "telegram" | "sms" | "whatsapp_qr" | "email" | "web" | "telegram_user" | "messenger" | "instagram" | "voice";
  title: string | null;
  ai_mode?: "auto" | "human";
  subject?: string | null;
  lead_score?: "hot" | "warm" | "cold" | null;
  summary?: string | null;
  deal_id?: string | null;
  contact_id: string | null;
  status: string;
  assignee_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_customer_at?: string | null;
  last_human_at?: string | null;
  last_ai_at?: string | null;
  last_auto_at?: string | null;
}

export default async function InboxPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("inbox.read")) {
    return (
      <Card>
        <EmptyState icon={<Inbox className="h-6 w-6" />} title={t("errors.forbidden")} />
      </Card>
    );
  }
  const sp = await searchParams;
  const filter = (FILTERS as readonly string[]).includes(String(sp.f)) ? (sp.f as (typeof FILTERS)[number]) : "open";
  const selectedId = uuidSchema.safeParse(sp.c).success ? (sp.c as string) : null;
  // wave 24: channel / search / quick-flag filters (all kept in the URL, so links and refresh keep them)
  const chFilter = (INBOX_CHANNELS as readonly string[]).includes(String(sp.ch)) ? (sp.ch as InboxChannel) : null;
  const flag = (INBOX_FLAGS as readonly string[]).includes(String(sp.fl)) ? (sp.fl as InboxFlag) : null;
  const search = searchTerm(sp.q);
  const supabase = await createClient();

  let q = supabase
    .from("conversations")
    .select("id, channel, title, contact_id, status, assignee_id, unread_count, last_message_at, last_message_preview, ai_mode, subject, lead_score, summary, deal_id, last_customer_at, last_human_at, last_ai_at, last_auto_at")
    .eq("organization_id", ctx.org.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (filter === "closed") q = q.eq("status", "closed");
  else {
    q = q.eq("status", "open");
    if (filter === "mine") q = q.eq("assignee_id", ctx.userId);
    if (filter === "unassigned") q = q.is("assignee_id", null);
  }
  if (chFilter) q = q.eq("channel", chFilter);
  if (search) q = q.or(`title.ilike.*${search}*,last_message_preview.ilike.*${search}*`);
  if (flag === "hot") q = q.eq("lead_score", "hot");
  if (flag === "human") q = q.eq("ai_mode", "human");
  const openCount = () => supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "open");
  const [{ count: cOpen }, { count: cMine }, { count: cUnassigned }, { count: cHuman }, { count: cHot }] = await Promise.all([
    openCount(),
    openCount().eq("assignee_id", ctx.userId),
    openCount().is("assignee_id", null),
    openCount().eq("ai_mode", "human"),
    openCount().eq("lead_score", "hot"),
  ]);
  const filterCount: Record<string, number | null> = { open: cOpen ?? null, mine: cMine ?? null, unassigned: cUnassigned ?? null, closed: null };
  const [{ data: convs }, { count: channelCount }, members] = await Promise.all([
    q,
    supabase.from("channel_accounts").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id),
    memberOptions(ctx.org.id),
  ]);
  const nowMs = new Date().getTime();
  const allRows = (convs ?? []) as ConvRow[];
  const list = flag === "waiting" ? allRows.filter((c) => waitingMinutes(c, nowMs) !== null) : allRows;
  const waitingCount = allRows.filter((c) => waitingMinutes(c, nowMs) !== null).length;
  const flagCount: Record<InboxFlag, number | null> = { waiting: flag === null || flag === "waiting" ? waitingCount : null, hot: cHot ?? null, human: cHuman ?? null };
  const memberName = new Map(members.map((m) => [m.id, m.label]));

  let selected: ConvRow | null = list.find((c) => c.id === selectedId) ?? null;
  if (selectedId && !selected) {
    const { data } = await supabase
      .from("conversations")
      .select("id, channel, title, contact_id, status, assignee_id, unread_count, last_message_at, last_message_preview, ai_mode, subject, lead_score, summary, deal_id, last_customer_at, last_human_at, last_ai_at, last_auto_at")
      .eq("id", selectedId)
      .eq("organization_id", ctx.org.id)
      .maybeSingle();
    selected = (data as ConvRow | null) ?? null;
  }
  // conversation guard: one state for all channels (ownership, consent, planned items, blocked reasons)
  const guardState = selected ? ((await supabase.rpc("conversation_state", { p_conversation: selected.id })).data as ConversationStateView | null) : null;
  const { data: msgs } = selected
    ? await supabase.from("messages").select("id, direction, body, status, error, created_at, sent_by, media, ai_agent_id, meta").eq("organization_id", ctx.org.id).eq("conversation_id", selected.id).order("created_at").limit(300)
    : { data: [] };
  // wave 21: why the agent is not answering this conversation (plain words + back to the agent)
  let aiNote: { key: AiNoteKey; resumeIn: number | null } | null = null;
  if (selected) {
    const lastMsg = (msgs ?? []).at(-1);
    const holding = lastMsg?.direction === "out" && (lastMsg.meta as { fallback?: boolean } | null)?.fallback === true;
    if (selected.ai_mode === "human" || holding) {
      const [{ data: note }, { data: ag }] = await Promise.all([
        supabase.from("conversations").select("ai_note, owner_takeover_at").eq("id", selected.id).maybeSingle(),
        supabase.from("ai_agents").select("profile").eq("organization_id", ctx.org.id).eq("enabled", true).contains("autopilot_channels", [selected.channel]).order("created_at").limit(1).maybeSingle(),
      ]);
      const n = (note ?? null) as { ai_note?: string | null; owner_takeover_at?: string | null } | null;
      const minutes = (ag?.profile as { resume_after_minutes?: number } | null)?.resume_after_minutes ?? DEFAULT_RESUME_MINUTES;
      const key: AiNoteKey = selected.ai_mode !== "human" ? "busy" : aiNoteKey(n?.ai_note ?? (n?.owner_takeover_at ? "owner_phone" : null));
      aiNote = { key, resumeIn: key === "owner_phone" ? resumeInMinutes(n?.owner_takeover_at, minutes) : null };
    }
  }
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { f: filter === "open" ? undefined : filter, ch: chFilter ?? undefined, fl: flag ?? undefined, q: search ?? undefined, c: selectedId ?? undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/${locale}/inbox${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <LiveRefresh />
      <PageHeader title={t("inbox.title")} description={t("inbox.subtitle")} />
      {(channelCount ?? 0) === 0 ? (
        <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Plug className="h-5 w-5 shrink-0 text-accent" />
          <span className="flex-1 text-sm text-muted">{t("inbox.noChannels")}</span>
          {ctx.can("integrations.manage") ? (
            <Link href={`/${locale}/integrations`} className="text-sm font-medium text-accent hover:underline">
              {t("inbox.connectChannels")}
            </Link>
          ) : null}
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className={cn("overflow-hidden", selected && "hidden lg:block")}>
          <div className="flex gap-1 overflow-x-auto border-b border-line p-2" role="tablist" aria-label={t("inbox.filter")}>
            {FILTERS.map((f) => (
              <Link key={f} href={href({ f: f === "open" ? undefined : f, c: undefined })} role="tab" aria-selected={filter === f} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px]", filter === f ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover")}>
                {t(`inbox.filters.${f}`)}
                {filterCount[f] ? <span className="ms-1.5 rounded-full bg-surface-hover px-1.5 text-[11px] font-semibold tabular-nums text-muted" data-testid={`inbox-count-${f}`}>{filterCount[f]}</span> : null}
              </Link>
            ))}
          </div>
          {/* wave 24: search + channel + quick flags */}
          <form key={`${filter}|${flag ?? ""}|${chFilter ?? ""}|${search ?? ""}`} action={`/${locale}/inbox`} method="get" className="flex gap-2 border-b border-line p-2" role="search" data-testid="inbox-search">
            {filter !== "open" ? <input type="hidden" name="f" value={filter} /> : null}
            {flag ? <input type="hidden" name="fl" value={flag} /> : null}
            <input name="q" defaultValue={search ?? ""} placeholder={t("inbox.tools.searchPlaceholder")} aria-label={t("inbox.tools.search")} maxLength={60} className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none focus:border-accent" />
            <select name="ch" defaultValue={chFilter ?? ""} aria-label={t("inbox.tools.channel")} className="h-9 max-w-[42%] rounded-lg border border-line bg-surface px-2 text-[13px]">
              <option value="">{t("inbox.tools.allChannels")}</option>
              {INBOX_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>{t(`campaigns.channels.${ch}`)}</option>
              ))}
            </select>
            <button type="submit" className="h-9 shrink-0 rounded-lg bg-accent-solid px-3 text-[13px] font-semibold text-accent-fg">{t("inbox.tools.go")}</button>
          </form>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-2 py-1.5" aria-label={t("inbox.tools.quick")}>
            {INBOX_FLAGS.map((fl) => (
              <Link key={fl} href={href({ fl: flag === fl ? undefined : fl, c: undefined })} aria-pressed={flag === fl} data-testid={`inbox-flag-${fl}`} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]", flag === fl ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:bg-surface-hover")}>
                {fl === "waiting" ? "⏳" : fl === "hot" ? "🔥" : "🙋"} {t(`inbox.tools.flags.${fl}`)}
                {flagCount[fl] ? <span className="tabular-nums">· {flagCount[fl]}</span> : null}
              </Link>
            ))}
            {chFilter || search || flag ? (
              <Link href={href({ ch: undefined, q: undefined, fl: undefined, c: undefined })} className="shrink-0 px-2 py-1 text-[12px] text-accent hover:underline" data-testid="inbox-clear">
                {t("inbox.tools.clear")}
              </Link>
            ) : null}
          </div>
          {list.length === 0 ? (
            <p className="p-6 text-center text-sm text-subtle">{t("inbox.empty")}</p>
          ) : (
            <ul className="max-h-[70dvh] divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const Icon = CHANNEL_ICON[c.channel] ?? MessageCircle;
                const wait = waitingMinutes(c, nowMs);
                const tone = slaTone(wait);
                return (
                  <li key={c.id}>
                    <Link href={href({ c: c.id })} className={cn("flex gap-3 px-4 py-3 hover:bg-surface-hover", selected?.id === c.id && "bg-accent-soft/50")} data-conversation={c.id}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label={t(`campaigns.channels.${c.channel}`)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("truncate text-sm", c.unread_count > 0 ? "font-bold" : "font-medium")}>{c.title ?? "—"}</span>
                          {c.unread_count > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-solid px-1.5 text-[11px] font-bold text-accent-fg">{c.unread_count}</span> : null}
                        </div>
                        <p className="truncate text-[12.5px] text-muted">{c.last_message_preview ?? ""}</p>
                        {c.ai_mode === "human" ? <p className="text-[11px] font-medium text-warning">{t("inbox.needsHuman")}</p> : null}
                        {c.lead_score ? <p className={cn("text-[11px] font-medium", c.lead_score === "hot" ? "text-danger" : c.lead_score === "warm" ? "text-gold" : "text-subtle")}>{t(`inbox.lead.${c.lead_score}`)}</p> : null}
                        <p className="text-[11px] text-subtle">{c.last_message_at ? formatDateTime(locale, c.last_message_at) : ""}</p>
                        {wait !== null ? (
                          <p data-testid="sla-badge" className={cn("mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold", tone === "late" ? "bg-danger/10 text-danger" : tone === "warn" ? "bg-gold/10 text-gold" : "bg-success/10 text-success")}>
                            ⏳ {t("inbox.tools.waiting", { time: waitLabel(wait, locale) })}
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {selected ? (
          <Card className="flex min-h-[60dvh] flex-col overflow-hidden">
            <MarkRead conversationId={selected.id} unread={selected.unread_count} />
            <header className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
              <Link href={href({ c: undefined })} className="inline-flex items-center gap-1 text-[13px] text-muted lg:hidden">
                <Back className="h-4 w-4" /> {t("inbox.title")}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-semibold">{selected.title ?? "—"}</h2>
                  <Badge tone="neutral">{t(`campaigns.channels.${selected.channel}`)}</Badge>
                </div>
                {selected.subject ? <p className="truncate text-[12.5px] text-muted" dir="auto">{selected.subject}</p> : null}
                {selected.lead_score ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="lead-info">
                    <Badge tone={selected.lead_score === "hot" ? "danger" : selected.lead_score === "warm" ? "gold" : "neutral"}>{t(`inbox.lead.${selected.lead_score}`)}</Badge>
                    {selected.deal_id ? (
                      <Link href={`/${locale}/pipelines`} className="text-[12px] font-medium text-accent hover:underline">
                        {t("inbox.lead.deal")}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {selected.summary ? <p className="mt-1 line-clamp-2 text-[12px] text-muted" dir="auto">🤖 {selected.summary}</p> : null}
                {selected.contact_id ? (
                  <Link href={`/${locale}/crm/${selected.contact_id}`} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
                    <User className="h-3.5 w-3.5" /> {t("inbox.openContact")}
                  </Link>
                ) : null}
              </div>
              {ctx.can("inbox.reply") ? <AiModeToggle conversationId={selected.id} mode={selected.ai_mode ?? "auto"} /> : null}
              {ctx.can("inbox.reply") ? <ConversationControls conversationId={selected.id} status={selected.status} assigneeId={selected.assignee_id} members={members} /> : null}
            </header>
            {guardState ? <ConversationStatePanel conversationId={selected.id} state={guardState} canReply={ctx.can("inbox.reply")} /> : null}
            {aiNote ? (
              <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 text-[13px]", aiNote.key === "busy" ? "bg-accent-soft/40" : "bg-warning-soft/60")} data-testid="ai-note" data-note={aiNote.key}>
                <Bot className="h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 leading-relaxed">
                  {t(`inbox.aiNote.${aiNote.key}`)}
                  {aiNote.key === "owner_phone" ? ` ${aiNote.resumeIn === null ? t("inbox.aiNote.noResume") : aiNote.resumeIn === 0 ? t("inbox.aiNote.resumeNext") : t("inbox.aiNote.resumeIn", { n: String(aiNote.resumeIn) })}` : ""}
                </span>
                {aiNote.key !== "busy" && ctx.can("inbox.reply") ? <AiModeToggle conversationId={selected.id} mode="human" testId="ai-note-resume" /> : null}
              </div>
            ) : null}
            <ol className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
              {(msgs ?? []).map((m) => {
                const out = m.direction === "out";
                return (
                  <li key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", out ? (m.ai_agent_id ? "border border-gold/30 bg-gold-soft text-fg" : "bg-accent-solid text-accent-fg") : "bg-elevated")} data-ai={m.ai_agent_id ? "1" : undefined}>
                      {out && m.ai_agent_id ? (
                        <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold text-gold">
                          <Bot className="h-3.5 w-3.5" /> {t("inbox.aiReply")}
                        </p>
                      ) : null}
                      {out && !m.ai_agent_id && (m.meta as { owner?: boolean } | null)?.owner ? (
                        <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold opacity-80" data-testid="owner-badge">
                          <Smartphone className="h-3.5 w-3.5" /> {t("inbox.ownerPhone")}
                        </p>
                      ) : null}
                      {(m.meta as { media?: { url?: string; title?: string } } | null)?.media?.url ? (
                        <a href={(m.meta as { media: { url: string } }).media.url} target="_blank" rel="noopener noreferrer" className="mb-1.5 block overflow-hidden rounded-xl" data-testid="inbox-image">
                          {/* eslint-disable-next-line @next/next/no-img-element -- the business's own gallery image */}
                          <img src={(m.meta as { media: { url: string } }).media.url} alt={(m.meta as { media: { title?: string } }).media.title ?? ""} className="max-h-56 w-full object-cover" loading="lazy" />
                        </a>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words" dir="auto">
                        {(m.body as string) || (m.media ? "📎" : "")}
                      </p>
                      {typeof (m.meta as { transcript?: string } | null)?.transcript === "string" && (m.meta as { transcript: string }).transcript !== m.body ? (
                        <p className="mt-1 rounded-lg bg-surface/60 px-2 py-1 text-[12.5px] text-muted" dir="auto" data-testid="voice-transcript">
                          🎙️ {(m.meta as { transcript: string }).transcript}
                        </p>
                      ) : null}
                      {typeof (m.meta as { vision?: string } | null)?.vision === "string" ? (
                        <p className="mt-1 rounded-lg bg-surface/60 px-2 py-1 text-[12.5px] text-muted" dir="auto" data-testid="vision-note">
                          🖼️ {(m.meta as { vision: string }).vision}
                        </p>
                      ) : null}
                      <p className={cn("mt-1 text-[10.5px]", out && !m.ai_agent_id ? "text-accent-fg/75" : "text-subtle")}>
                        {formatDateTime(locale, m.created_at as string)}
                        {out ? ` · ${t(`inbox.status.${m.status}`)}${m.sent_by ? ` · ${memberName.get(m.sent_by as string) ?? ""}` : ""}` : ""}
                        {/* speed upgrade: how fast the agent answered */}
                        {out && m.ai_agent_id && latencyLabel((m.meta as { timing?: { total?: number } } | null)?.timing?.total) ? (
                          <span data-testid="ai-latency" title={t("inbox.aiLatency")}>{` · ⚡ ${latencyLabel((m.meta as { timing: { total: number } }).timing.total)}`}</span>
                        ) : null}
                      </p>
                      {typeof (m.meta as { document_text?: string } | null)?.document_text === "string" ? (
                        <p className="mt-1 rounded-lg bg-surface/60 px-2 py-1 text-[12.5px] text-muted" dir="auto" data-testid="document-note">
                          📄 {(m.meta as { document_text: string }).document_text}
                        </p>
                      ) : null}
                      {m.status === "failed" && m.error ? <p className="mt-1 text-[11px] text-danger">{m.error as string}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {ctx.can("inbox.reply") ? (
              <ConversationTools conversationId={selected.id} currency={ctx.org.currency || "ILS"} canAI={ctx.can("ai.use")} canFinance={ctx.can("finance.write")} canWriteContacts={ctx.can("contacts.write")} />
            ) : null}
            {ctx.can("inbox.reply") ? <SavedReplies conversationId={selected.id} locale={locale} customerName={selected.title} businessName={ctx.org.name} /> : null}
            {selected.channel === "voice" && ctx.can("inbox.reply") ? (
              <p className="border-t border-line px-4 py-2 text-[12px] text-muted" data-testid="voice-reply-note">📞 {t("inbox.voiceReplyNote")}</p>
            ) : null}
            {ctx.can("inbox.reply") ? <ReplyBox conversationId={selected.id} /> : null}
          </Card>
        ) : (
          <Card className="hidden min-h-[60dvh] lg:grid lg:place-items-center">
            <EmptyState icon={<Inbox className="h-6 w-6" />} title={t("inbox.pick")} />
          </Card>
        )}
      </div>
    </>
  );
}
