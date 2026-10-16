"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LifeBuoy, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { createPublicTicket, replyPublicTicket } from "@/app/[locale]/(public)/actions";
import { cn } from "@/lib/utils";

export function NewTicketForm({ org, orgName }: { org: string; orgName: string }) {
  const { t, locale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; token: string } | null>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <div role="status" className="rounded-3xl border border-line bg-surface p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <h1 className="mt-4 text-xl font-bold">{t("support.portalCreated", { number: done.number })}</h1>
        <a href={`/${locale}/t/${done.token}`} className="mt-4 inline-block text-accent underline">
          {t("support.portalTrack")}
        </a>
      </div>
    );
  }
  return (
    <form
      className="space-y-4 rounded-3xl border border-line bg-surface p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await createPublicTicket({ org, name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? "") });
          if (r.ok && r.data) setDone(r.data as { number: number; token: string });
          else setError(t(r.error ?? "errors.generic"));
        });
      }}
    >
      <header>
        <p className="text-[12.5px] font-medium text-subtle">{orgName}</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <LifeBuoy className="h-6 w-6 text-accent" /> {t("support.portalTitle")}
        </h1>
      </header>
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${t("booking.yourName")} *`} htmlFor="sp-name">
          <Input id="sp-name" name="name" required autoComplete="name" />
        </Field>
        <Field label={`${t("crm.email")} *`} htmlFor="sp-email">
          <Input id="sp-email" name="email" type="email" dir="ltr" required autoComplete="email" />
        </Field>
      </div>
      <Field label={`${t("support.subject")} *`} htmlFor="sp-subject">
        <Input id="sp-subject" name="subject" required />
      </Field>
      <Field label={`${t("support.describe")} *`} htmlFor="sp-body">
        <Textarea id="sp-body" name="body" rows={6} required />
      </Field>
      <Button type="submit" size="lg" loading={pending} className="w-full justify-center">
        {t("support.portalSubmit")}
      </Button>
    </form>
  );
}

export interface PublicTicket {
  number: number;
  subject: string;
  status: string;
  org: string;
  messages: { author: "customer" | "agent"; body: string; at: string; agent: string | null }[];
}

export function TicketThread({ token, ticket }: { token: string; ticket: PublicTicket }) {
  const { t, intl } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface p-6 sm:p-8">
      <header>
        <p className="text-[12.5px] font-medium text-subtle">{ticket.org}</p>
        <h1 className="mt-1 text-xl font-bold">
          <span dir="ltr">#{ticket.number}</span> · {ticket.subject}
        </h1>
        <p className="mt-1 text-[13px] text-muted">{t(`support.publicStatuses.${ticket.status}`)}</p>
      </header>
      <ol className="space-y-3">
        {ticket.messages.map((m, i) => (
          <li key={i} className={cn("rounded-2xl p-3.5 text-sm", m.author === "customer" ? "bg-elevated" : "bg-accent-soft")}>
            <div className="mb-1 text-[12px] text-muted">
              {m.author === "customer" ? t("support.you") : m.agent || ticket.org} · {fmt.format(new Date(m.at))}
            </div>
            <p className="whitespace-pre-wrap" dir="auto">
              {m.body}
            </p>
          </li>
        ))}
      </ol>
      {ticket.status !== "closed" ? (
        <div className="space-y-2">
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Textarea aria-label={t("support.reply")} rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button
            loading={pending}
            disabled={!body.trim()}
            onClick={() =>
              start(async () => {
                const r = await replyPublicTicket({ token, body });
                if (r.ok) {
                  setBody("");
                  router.refresh();
                } else setError(t(r.error ?? "errors.generic"));
              })
            }
          >
            <Send className="h-4 w-4 rtl:-scale-x-100" /> {t("support.sendReply")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
