import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Bot, Globe, Inbox, Mail, MessageCircle, Plug, QrCode, Send, Smartphone, User, UserRound } from "lucide-react";
import { uuidSchema } from "@scc/shared/validators";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AiModeToggle, ConversationControls, LiveRefresh, MarkRead, ReplyBox } from "@/components/inbox/inbox-client";

// icons resolved on the server (objects exported from client modules are only references here)
const CHANNEL_ICON = { whatsapp: MessageCircle, telegram: Send, sms: Smartphone, whatsapp_qr: QrCode, email: Mail, web: Globe, telegram_user: UserRound } as const;
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
  channel: "whatsapp" | "telegram" | "sms" | "whatsapp_qr" | "email" | "web" | "telegram_user";
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
  const supabase = await createClient();

  let q = supabase
    .from("conversations")
    .select("id, channel, title, contact_id, status, assignee_id, unread_count, last_message_at, last_message_preview, ai_mode, subject, lead_score, summary, deal_id")
    .eq("organization_id", ctx.org.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (filter === "closed") q = q.eq("status", "closed");
  else {
    q = q.eq("status", "open");
    if (filter === "mine") q = q.eq("assignee_id", ctx.userId);
    if (filter === "unassigned") q = q.is("assignee_id", null);
  }
  const [{ data: convs }, { count: channelCount }, members] = await Promise.all([
    q,
    supabase.from("channel_accounts").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id),
    memberOptions(ctx.org.id),
  ]);
  const list = (convs ?? []) as ConvRow[];
  const memberName = new Map(members.map((m) => [m.id, m.label]));

  let selected: ConvRow | null = list.find((c) => c.id === selectedId) ?? null;
  if (selectedId && !selected) {
    const { data } = await supabase
      .from("conversations")
      .select("id, channel, title, contact_id, status, assignee_id, unread_count, last_message_at, last_message_preview, ai_mode, subject, lead_score, summary, deal_id")
      .eq("id", selectedId)
      .eq("organization_id", ctx.org.id)
      .maybeSingle();
    selected = (data as ConvRow | null) ?? null;
  }
  const { data: msgs } = selected
    ? await supabase.from("messages").select("id, direction, body, status, error, created_at, sent_by, media, ai_agent_id, meta").eq("organization_id", ctx.org.id).eq("conversation_id", selected.id).order("created_at").limit(300)
    : { data: [] };
  const Back = locale === "en" ? ArrowLeft : ArrowRight;
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { f: filter === "open" ? undefined : filter, c: selectedId ?? undefined, ...over };
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
              </Link>
            ))}
          </div>
          {list.length === 0 ? (
            <p className="p-6 text-center text-sm text-subtle">{t("inbox.empty")}</p>
          ) : (
            <ul className="max-h-[70dvh] divide-y divide-line overflow-y-auto">
              {list.map((c) => {
                const Icon = CHANNEL_ICON[c.channel];
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
                      {(m.meta as { media?: { url?: string; title?: string } } | null)?.media?.url ? (
                        <a href={(m.meta as { media: { url: string } }).media.url} target="_blank" rel="noopener noreferrer" className="mb-1.5 block overflow-hidden rounded-xl" data-testid="inbox-image">
                          {/* eslint-disable-next-line @next/next/no-img-element -- the business's own gallery image */}
                          <img src={(m.meta as { media: { url: string } }).media.url} alt={(m.meta as { media: { title?: string } }).media.title ?? ""} className="max-h-56 w-full object-cover" loading="lazy" />
                        </a>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words" dir="auto">
                        {(m.body as string) || (m.media ? "📎" : "")}
                      </p>
                      <p className={cn("mt-1 text-[10.5px]", out && !m.ai_agent_id ? "text-accent-fg/75" : "text-subtle")}>
                        {formatDateTime(locale, m.created_at as string)}
                        {out ? ` · ${t(`inbox.status.${m.status}`)}${m.sent_by ? ` · ${memberName.get(m.sent_by as string) ?? ""}` : ""}` : ""}
                      </p>
                      {m.status === "failed" && m.error ? <p className="mt-1 text-[11px] text-danger">{m.error as string}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
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
