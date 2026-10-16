"use client";

import { useState, useTransition } from "react";
import { BellRing, BriefcaseBusiness, CheckCircle2, Copy, Mail, MessageCircle, Phone, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { addRecipientAction, deleteRecipientAction, testRecipientAction, updateRecipientAction } from "@/app/[locale]/(dashboard)/integrations/actions";
import { cn } from "@/lib/utils";

export interface RecipientView {
  id: string;
  kind: "email" | "telegram" | "whatsapp" | "sms";
  target: string | null;
  label: string | null;
  events: string[];
  enabled: boolean;
  invite_code: string | null;
  last_sent_at: string | null;
  last_error: string | null;
  sent_count: number;
}

export interface BusinessView {
  id: string;
  owner_name: string | null;
  owner_username: string | null;
  can_reply: boolean;
  is_enabled: boolean;
  messages_in: number;
  messages_out: number;
  last_message_at: string | null;
}

const KINDS = [
  { k: "telegram", icon: Send },
  { k: "email", icon: Mail },
  { k: "whatsapp", icon: MessageCircle },
  { k: "sms", icon: Phone },
] as const;
const EVENTS = ["messages", "leads", "handoff"] as const;

/**
 * Who else gets what the agent does: invite a Telegram user (link to the
 * business's bot), an e-mail, a WhatsApp or SMS number; choose the updates
 * (every conversation, new leads, requests for a person); test; pause; remove.
 * Plus the Telegram Business status (the bot running the owner's own account).
 */
export function TeamUpdates({ recipients, botUsername, business }: { recipients: RecipientView[]; botUsername: string | null; business: BusinessView[] }) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>(botUsername ? "telegram" : "email");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [events, setEvents] = useState<string[]>(["leads", "handoff"]);
  const [pending, start] = useTransition();
  const link = (code: string) => (botUsername ? `https://t.me/${botUsername}?start=n_${code}` : "");
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success(t("notify.copied")), () => undefined);

  const add = () =>
    start(async () => {
      const r = await addRecipientAction({ locale, kind, target, label, events });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t("notify.added"));
      setTarget("");
      setLabel("");
      if (r.data?.invite) copy(link(r.data.invite));
    });

  return (
    <div className="mb-4 space-y-4">
      <Card className="overflow-hidden" data-testid="tg-business">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <BriefcaseBusiness className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{t("notify.business.title")}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("notify.business.subtitle")}</p>
          </div>
        </div>
        {business.length ? (
          <ul className="divide-y divide-line">
            {business.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm" data-testid="tg-business-row">
                <span className="font-medium">{b.owner_name ?? t("notify.business.owner")}</span>
                {b.owner_username ? <span dir="ltr" className="text-subtle">@{b.owner_username}</span> : null}
                <Badge tone={b.is_enabled && b.can_reply ? "success" : b.is_enabled ? "warning" : "neutral"}>
                  {b.is_enabled ? (b.can_reply ? t("notify.business.active") : t("notify.business.noReply")) : t("notify.business.off")}
                </Badge>
                <span className="text-[12px] text-subtle">{t("notify.business.counts", { in: b.messages_in, out: b.messages_out })}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <ol className="list-decimal space-y-1 px-9 py-3 text-[12.5px] leading-relaxed text-muted">
          <li>{t("notify.business.step1")}</li>
          <li>{botUsername ? t("notify.business.step2", { bot: `@${botUsername}` }) : t("notify.business.step2NoBot")}</li>
          <li>{t("notify.business.step3")}</li>
          <li>{t("notify.business.step4")}</li>
        </ol>
      </Card>

      <Card className="overflow-hidden" data-testid="team-updates">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{t("notify.title")}</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t("notify.subtitle")}</p>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("notify.kind")}>
            {KINDS.map(({ k, icon: Icon }) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                data-kind={k}
                className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition", kind === k ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-hover")}
              >
                <Icon className="h-4 w-4" /> {t(`notify.kinds.${k}`)}
              </button>
            ))}
          </div>
          {kind === "telegram" ? (
            <p className="rounded-xl bg-elevated p-3 text-[12.5px] leading-relaxed text-muted">{botUsername ? t("notify.telegramHint", { bot: `@${botUsername}` }) : t("notify.needBot")}</p>
          ) : (
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={kind === "email" ? "name@example.com" : "050-1234567"}
              aria-label={t("notify.target")}
              dir="ltr"
              inputMode={kind === "email" ? "email" : "tel"}
              data-testid="notify-target"
            />
          )}
          {kind === "whatsapp" || kind === "sms" ? <p className="text-[12px] text-subtle">{t(`notify.${kind}Hint`)}</p> : null}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("notify.labelPlaceholder")} aria-label={t("notify.label")} maxLength={80} />
          <div className="flex flex-wrap gap-2">
            {EVENTS.map((ev) => (
              <label key={ev} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px]", events.includes(ev) ? "border-accent bg-accent-soft text-accent" : "border-line")}>
                <input type="checkbox" className="sr-only" checked={events.includes(ev)} onChange={() => setEvents(events.includes(ev) ? events.filter((x) => x !== ev) : [...events, ev])} />
                {events.includes(ev) ? <CheckCircle2 className="h-4 w-4" /> : null}
                {t(`notify.events.${ev}`)}
              </label>
            ))}
          </div>
          <Button onClick={add} loading={pending} disabled={!events.length || (kind === "telegram" && !botUsername)} className="w-full sm:w-auto" data-testid="notify-add">
            <UserPlus className="h-4 w-4" /> {kind === "telegram" ? t("notify.createInvite") : t("notify.add")}
          </Button>
        </div>

        {recipients.length ? (
          <ul className="divide-y divide-line border-t border-line" data-testid="notify-list">
            {recipients.map((r) => {
              const Icon = KINDS.find((x) => x.k === r.kind)?.icon ?? Mail;
              const waiting = r.kind === "telegram" && !r.target;
              return (
                <li key={r.id} className="space-y-2 px-4 py-3" data-recipient={r.kind} data-linked={waiting ? "0" : "1"}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 truncate font-medium">{r.label || (r.kind === "telegram" ? t("notify.kinds.telegram") : r.target)}</span>
                    {r.target && r.kind !== "telegram" ? <span dir="ltr" className="truncate text-[12px] text-subtle">{r.target}</span> : null}
                    <Badge tone={!r.enabled ? "neutral" : waiting ? "warning" : r.last_error ? "danger" : "success"}>
                      {!r.enabled ? t("notify.paused") : waiting ? t("notify.waiting") : r.last_error ? t("notify.error") : t("notify.active")}
                    </Badge>
                    <span className="text-[11.5px] text-subtle">{r.events.map((e) => t(`notify.events.${e}`)).join(" · ")}</span>
                  </div>
                  {waiting && r.invite_code ? (
                    <div className="flex items-center gap-2">
                      <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-2.5 py-1.5 text-[11.5px]" data-testid="notify-invite">
                        {link(r.invite_code)}
                      </code>
                      <Button size="sm" variant="secondary" onClick={() => copy(link(r.invite_code!))} aria-label={t("notify.copy")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                  {r.last_error ? <p className="text-[11.5px] text-danger" dir="ltr">{r.last_error}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={pending || waiting} onClick={() => start(async () => { const x = await testRecipientAction({ locale, id: r.id }); if (x.error) toast.error(t(x.error, x.messageParams)); else toast.success(t("notify.testSent")); })}>
                      <Send className="h-3.5 w-3.5" /> {t("notify.test")}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const x = await updateRecipientAction({ locale, id: r.id, enabled: !r.enabled }); if (x.error) toast.error(t(x.error)); })}>
                      {r.enabled ? t("notify.pause") : t("notify.resume")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => start(async () => { const x = await deleteRecipientAction({ locale, id: r.id }); if (x.error) toast.error(t(x.error)); })} aria-label={t("common.delete")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
