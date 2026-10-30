"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Bot, CheckCircle2, Circle, Clock, Headphones, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOutgoing, Radio, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getPhoneNumberAction, setTransferNumberAction, testCallAction, wireOwnNumberAction } from "@/app/[locale]/(dashboard)/phone/actions";

export interface PhoneCenterView {
  agent: { id: string; name: string } | null;
  voiceReady: boolean;
  persona: boolean;
  live: boolean;
  own: string | null;
  ownRaw: string | null;
  platformReady: boolean;
  platformNumber: string | null;
  minutes: { used: number; limit: number; left: number | null } | null;
  transfer: string | null;
  canManage: boolean;
  canIntegrations: boolean;
  calls: { id: string; direction: "in" | "out"; other: string; status: string; duration: number | null; summary: string | null; live: boolean; at: string }[];
}

function Step({ done, n, title, body, children, current }: { done: boolean; n: number; title: string; body: string; children?: React.ReactNode; current: boolean }) {
  return (
    <li className={cn("relative rounded-2xl border p-4 transition", done ? "border-success/30 bg-success-soft/30" : current ? "border-accent/50 bg-accent-soft/40 shadow-sm" : "border-line bg-surface")} data-phone-step={n} data-done={done ? "1" : "0"}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold", done ? "bg-success text-white" : current ? "bg-accent-solid text-accent-fg" : "bg-elevated text-muted")}>{done ? <CheckCircle2 className="h-4.5 w-4.5" aria-hidden /> : n}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{body}</p>
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </li>
  );
}

/** Wave 57 — the phone agent hub: a checklist that shows the one thing left, actions in place, a test call, recent calls. */
export function PhoneCenter({ view }: { view: PhoneCenterView }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [testPhone, setTestPhone] = useState("");
  const [transfer, setTransfer] = useState(view.transfer ?? "");
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      router.refresh();
    });
  const number = view.own ?? view.platformNumber;
  const steps = [Boolean(view.agent), Boolean(number), view.voiceReady, Boolean(view.transfer)];
  const current = steps.findIndex((d) => !d);
  const ready = steps[0] && steps[1] && steps[2];
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const mins = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");

  return (
    <div className="space-y-4" data-testid="phone-center">
      {/* status hero */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className={cn("relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl", ready ? "bg-accent-solid text-accent-fg" : "bg-accent-soft text-accent")}>
            <PhoneCall className="h-6 w-6" aria-hidden />
            {ready ? <span className="absolute inset-0 animate-ping rounded-2xl bg-accent/30 [animation-duration:2.4s]" aria-hidden /> : null}
          </span>
          <div className="min-w-[14rem] flex-1">
            <p className="text-lg font-bold">{ready ? t("phone.readyTitle") : t("phone.notReadyTitle")}</p>
            <p className="text-[13px] text-muted">{ready ? t("phone.readyBody", { number: number ?? "" }) : t("phone.notReadyBody")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {number ? (
              <Badge tone="success">
                <bdi dir="ltr">{number}</bdi>
              </Badge>
            ) : null}
            <Badge tone={view.live ? "gold" : "neutral"}>
              <Radio className="me-1 inline h-3.5 w-3.5" aria-hidden />
              {t(view.live ? "phone.modeLive" : "phone.modeTurn")}
            </Badge>
          </div>
        </div>
        {view.minutes && view.minutes.limit > 0 ? (
          <div className="border-t border-line px-5 py-3 text-[12.5px]">
            <div className="mb-1 flex justify-between">
              <span className="text-muted">{t("phone.minutes")}</span>
              <span className="tabular-nums">{t("phone.minutesOf", { used: String(view.minutes.used), limit: String(view.minutes.limit) })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-elevated" aria-hidden>
              <div className="h-full rounded-full bg-accent-solid transition-[width] duration-700" style={{ width: `${Math.min(100, Math.round((view.minutes.used / Math.max(1, view.minutes.limit)) * 100))}%` }} />
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader title={t("phone.stepsTitle")} description={t("phone.stepsSubtitle")} />
          <ol className="stagger space-y-3 p-5">
            <Step n={1} done={steps[0]!} current={current === 0} title={t("phone.s1.title")} body={view.agent ? t("phone.s1.done", { name: view.agent.name }) : t("phone.s1.body")}>
              <Link href={`/${locale}/ai-agents`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
                <Bot className="h-4 w-4" aria-hidden /> {t(view.agent ? "phone.s1.edit" : "phone.s1.cta")}
              </Link>
            </Step>
            <Step n={2} done={steps[1]!} current={current === 1} title={t("phone.s2.title")} body={view.own ? t("phone.s2.own") : view.platformNumber ? t("phone.s2.platform") : view.platformReady ? t("phone.s2.body") : t("phone.s2.bodyOwn")}>
              {view.own ? (
                view.canIntegrations ? (
                  <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => wireOwnNumberAction({ locale }))} data-testid="phone-wire">
                    <Wand2 className="h-4 w-4" aria-hidden /> {t("phone.s2.wire")}
                  </Button>
                ) : null
              ) : view.platformNumber ? null : view.platformReady && view.canManage ? (
                <Button loading={pending} onClick={() => run(() => getPhoneNumberAction({ locale }))} data-testid="phone-get-number">
                  <Sparkles className="h-4 w-4" aria-hidden /> {t("phone.s2.get")}
                </Button>
              ) : (
                <Link href={`/${locale}/integrations`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
                  {t("phone.s2.connectOwn")}
                </Link>
              )}
            </Step>
            <Step n={3} done={steps[2]!} current={current === 2} title={t("phone.s3.title")} body={view.voiceReady ? (view.persona ? t("phone.s3.persona") : t("phone.s3.default")) : t("phone.s3.missing")}>
              {view.agent ? (
                <Link href={`/${locale}/ai-agents/${view.agent.id}/setup#voice`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
                  <AudioLines className="h-4 w-4" aria-hidden /> {t("phone.s3.cta")}
                </Link>
              ) : null}
            </Step>
            <Step n={4} done={steps[3]!} current={current === 3} title={t("phone.s4.title")} body={t("phone.s4.body")}>
              {view.canIntegrations ? (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => setTransferNumberAction({ locale, phone: transfer }));
                  }}
                >
                  <label htmlFor="phone-transfer" className="sr-only">
                    {t("phone.s4.title")}
                  </label>
                  <Input id="phone-transfer" dir="ltr" inputMode="tel" placeholder="050-1234567" value={transfer} onChange={(e) => setTransfer(e.target.value)} className="sm:max-w-[14rem]" />
                  <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={transfer.trim().length < 7}>
                    <PhoneForwarded className="h-4 w-4" aria-hidden /> {t("common.save")}
                  </Button>
                </form>
              ) : null}
            </Step>
          </ol>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t("phone.testTitle")} description={t("phone.testBody")} />
            <form
              className="flex flex-col gap-2 p-5 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => testCallAction({ locale, phone: testPhone }));
              }}
            >
              <label htmlFor="phone-test" className="sr-only">
                {t("phone.testTitle")}
              </label>
              <Input id="phone-test" dir="ltr" inputMode="tel" placeholder="050-1234567" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
              <Button type="submit" loading={pending} disabled={!ready || testPhone.trim().length < 7 || !view.canManage} data-testid="phone-test">
                <Headphones className="h-4 w-4" aria-hidden /> {t("phone.testCta")}
              </Button>
            </form>
            <ul className="space-y-1.5 border-t border-line px-5 py-4 text-[12.5px] text-muted">
              {(["t1", "t2", "t3", "t4", "t5"] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <Circle className="mt-1 h-2 w-2 shrink-0 fill-current text-accent" aria-hidden />
                  <span>{t(`phone.try.${k}`)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title={t("phone.callsTitle")} />
            {view.calls.length ? (
              <ul className="divide-y divide-line">
                {view.calls.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.direction === "in" ? <PhoneIncoming className="h-4 w-4 text-accent" aria-hidden /> : <PhoneOutgoing className="h-4 w-4 text-accent" aria-hidden />}
                      <bdi dir="ltr" className="font-medium">
                        {c.other}
                      </bdi>
                      {c.live ? <Badge tone="gold">{t("phone.modeLive")}</Badge> : null}
                      <span className="ms-auto inline-flex items-center gap-1 text-[12px] text-subtle">
                        <Clock className="h-3.5 w-3.5" aria-hidden /> {mins(c.duration)} · {when(c.at)}
                      </span>
                    </div>
                    {c.summary ? (
                      <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-muted" dir="auto">
                        {c.summary}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 text-[13px] text-muted">{t("phone.noCalls")}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
