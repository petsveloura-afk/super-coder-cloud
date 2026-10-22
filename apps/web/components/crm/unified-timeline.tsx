import Link from "next/link";
import { Bot, CalendarCheck, FileText, FormInput, Handshake, LifeBuoy, Mail, MessageCircle, MessageSquare, Send, Smartphone, StickyNote, Zap } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { formatCurrency, formatDateTime } from "@/lib/format";

export interface TimelineItem {
  kind: "message" | "note" | "activity" | "appointment" | "document" | "ticket" | "form" | "deal";
  at: string;
  id: string;
  channel?: string;
  direction?: "in" | "out";
  body?: string;
  conversation_id?: string;
  ai?: boolean;
  owner?: boolean;
  media?: string | null;
  type?: string;
  payload?: Record<string, unknown>;
  title?: string;
  status?: string;
  doc_kind?: string;
  number?: number;
  total?: number;
  currency?: string;
}

const CHANNEL_ICON: Record<string, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  whatsapp_qr: MessageCircle,
  telegram: Send,
  telegram_user: Send,
  sms: Smartphone,
  email: Mail,
  web: MessageSquare,
};

/**
 * Wave 15 — one timeline for the customer across every channel and module:
 * WhatsApp / Telegram / SMS / e-mail / website chat messages, notes, deals, quotes
 * and invoices, meetings, support tickets and form submissions.
 */
export async function UnifiedTimeline({ locale, items, contactId, more }: { locale: Locale; items: TimelineItem[]; contactId: string; more: string | null }) {
  const { t } = await getT(locale);
  if (!items.length) return <p className="p-6 text-center text-sm text-subtle">{t("timeline.empty")}</p>;
  return (
    <div className="p-5">
      <ol className="relative space-y-3 border-s border-line ps-5" data-testid="unified-timeline">
        {items.map((it) => {
          let Icon: typeof MessageCircle = Zap;
          let head = "";
          let body: React.ReactNode = null;
          let href: string | null = null;
          if (it.kind === "message") {
            Icon = CHANNEL_ICON[it.channel ?? ""] ?? MessageCircle;
            head = `${t(`timeline.channels.${it.channel ?? "web"}`)} · ${it.direction === "in" ? t("timeline.fromCustomer") : it.ai ? t("timeline.fromAI") : it.owner ? t("timeline.fromOwnerPhone") : t("timeline.fromTeam")}`;
            body = it.body ? <p className={`mt-1 whitespace-pre-wrap rounded-xl px-3.5 py-2 text-sm ${it.direction === "in" ? "bg-elevated" : "bg-accent-soft"}`}>{it.body}</p> : it.media ? <p className="mt-1 text-[13px] text-muted">📎 {it.media}</p> : null;
            href = it.conversation_id ? `/${locale}/inbox?c=${it.conversation_id}` : null;
          } else if (it.kind === "note") {
            Icon = StickyNote;
            head = t("timeline.note");
            body = <p className="mt-1 whitespace-pre-wrap rounded-xl bg-elevated px-3.5 py-2 text-sm">{it.body}</p>;
          } else if (it.kind === "activity") {
            Icon = it.type?.startsWith("deal") ? Handshake : it.type?.includes("analy") ? Bot : Zap;
            head = t(`timeline.activity.${(it.type ?? "other").replace(/\./g, "_")}`, it.payload as Record<string, string>) || it.type || "";
            if (head.startsWith("timeline.activity.")) head = t("timeline.activity.other");
          } else if (it.kind === "appointment") {
            Icon = CalendarCheck;
            head = `${t("timeline.appointment")} · ${t(`appointments.statuses.${it.status}`)}`;
            body = <p className="mt-0.5 text-sm">{it.title}</p>;
            href = `/${locale}/appointments`;
          } else if (it.kind === "document") {
            Icon = FileText;
            head = `${t(`finance.kinds.${it.doc_kind}`)} #${it.number} · ${t(`finance.statuses.${it.status}`)}`;
            body = it.total !== undefined ? <bdi dir="ltr" className="text-sm font-semibold">{formatCurrency(locale, Number(it.total), it.currency ?? "ILS")}</bdi> : null;
            href = `/${locale}/finance/${it.id}`;
          } else if (it.kind === "ticket") {
            Icon = LifeBuoy;
            head = `${t("timeline.ticket")} #${it.number} · ${t(`support.statuses.${it.status}`)}`;
            body = <p className="mt-0.5 text-sm">{it.title}</p>;
            href = `/${locale}/support/${it.id}`;
          } else if (it.kind === "form") {
            Icon = FormInput;
            head = t("timeline.form");
          } else if (it.kind === "deal") {
            Icon = Handshake;
            head = `${t("timeline.deal")} · ${t(`deals.statuses.${it.status}`)}`;
            body = (
              <p className="mt-0.5 text-sm">
                {it.title} · <bdi dir="ltr">{formatCurrency(locale, Number(it.total ?? 0), it.currency ?? "ILS")}</bdi>
              </p>
            );
            href = `/${locale}/pipelines`;
          }
          return (
            <li key={`${it.kind}-${it.id}`} className="relative" data-kind={it.kind} data-channel={it.channel ?? undefined}>
              <span className="absolute -start-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-surface ring-1 ring-line">
                <Icon className="h-3 w-3 text-accent" />
              </span>
              <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
                <span>{formatDateTime(locale, it.at)}</span>
                <span className="font-medium text-muted">{head}</span>
                {href ? (
                  <Link href={href} className="text-accent hover:underline">
                    {t("timeline.open")}
                  </Link>
                ) : null}
              </div>
              {body}
            </li>
          );
        })}
      </ol>
      {more ? (
        <div className="mt-4 text-center">
          <Link href={`/${locale}/crm/${contactId}?before=${encodeURIComponent(more)}#unified`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover">
            {t("timeline.more")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
