"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Brain,
  CalendarPlus,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock,
  FileText,
  Kanban,
  ListPlus,
  Megaphone,
  MessageSquareText,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Share2,
  Sparkles,
  StickyNote,
  Tag,
  UserCog,
  UserPlus,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { OP_EXAMPLES, type OpTool } from "@/lib/operator/operator-core";
import { operatorExecuteAction, operatorPlanAction, type OperatorPlan, type OpResult, type PlannedAction } from "@/app/[locale]/(dashboard)/operator/actions";

const ICON: Record<OpTool, typeof Zap> = {
  create_contact: UserPlus,
  update_contact: UserCog,
  add_note: StickyNote,
  add_tag: Tag,
  remember: Brain,
  create_task: ListPlus,
  complete_task: ClipboardCheck,
  create_deal: Kanban,
  move_deal: Kanban,
  book_meeting: CalendarPlus,
  schedule_message: MessageSquareText,
  draft_campaign: Megaphone,
  draft_post: Share2,
};

/** Args shown on the card (the rest are resolved into chips). */
const SHOW_ARGS = ["first_name", "last_name", "phone", "email", "company", "status", "title", "value", "tag", "fact", "body", "text", "name", "channel", "subject", "duration_min", "location", "lost_reason", "description", "note", "job_title", "tags", "platforms"];

export interface HistoryRow {
  id: string;
  instruction: string;
  status: string;
  created_at: string;
  count: number;
}

interface SpeechLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/**
 * Wave 54 — the AI Operator: write (or say) what should happen → the agent plans it → you approve → it is done.
 */
const noopSubscribe = () => () => undefined;
function speechSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function OperatorClient({ history, timeZone }: { history: HistoryRow[]; timeZone: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<OperatorPlan | null>(null);
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [results, setResults] = useState<OpResult[] | null>(null);
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const canSpeak = useSyncExternalStore(noopSubscribe, speechSupported, () => false);
  const recRef = useRef<SpeechLike | null>(null);

  const toggleMic = () => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new Ctor();
    rec.lang = locale === "en" ? "en-US" : locale === "ar" ? "ar-IL" : "he-IL";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (said) setText((cur) => (cur.trim() ? `${cur.trim()} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const makePlan = () =>
    start(async () => {
      setResults(null);
      const r = await operatorPlanAction({ locale, text });
      if (r.error) return void toast.error(t(r.error));
      if (!r.data) return;
      setPlan(r.data);
      setChosen({});
      setInclude(Object.fromEntries(r.data.actions.map((a) => [a.n, !a.warnings.includes("forbidden")])));
      if (!r.data.actions.length) toast.message(r.data.reply || t("operator.nothing"));
    });

  const pick = (a: PlannedAction, kind: "contact" | "deal" | "task") => chosen[`${kind}:${a.n}`] || a[kind]?.id || "";
  const blocked = (a: PlannedAction) => {
    if (a.warnings.includes("forbidden")) return true;
    if (a.contact && !a.contact.ref && !pick(a, "contact") && ["update_contact", "add_note", "add_tag", "remember", "schedule_message"].includes(a.tool)) return true;
    if (a.tool === "move_deal" && !pick(a, "deal")) return true;
    if (a.tool === "complete_task" && !pick(a, "task")) return true;
    if (a.warnings.includes("badTime") && ["book_meeting"].includes(a.tool)) return true;
    return false;
  };
  const selected = plan ? plan.actions.filter((a) => include[a.n] && !blocked(a)) : [];

  const execute = () =>
    start(async () => {
      if (!plan || !selected.length) return;
      const r = await operatorExecuteAction({
        locale,
        runId: plan.runId,
        actions: selected.map((a) => ({
          n: a.n,
          tool: a.tool,
          args: a.args,
          contactId: pick(a, "contact") || undefined,
          contactRef: a.contact?.ref ?? null,
          dealId: pick(a, "deal") || undefined,
          taskId: pick(a, "task") || undefined,
          assigneeId: a.assignee?.id,
          stageId: a.stage?.id,
          pipelineId: a.stage?.pipelineId,
          whenIso: a.whenIso ?? undefined,
        })),
      });
      if (r.error) return void toast.error(t(r.error));
      const res = r.data?.results ?? [];
      setResults(res);
      const ok = res.filter((x) => x.ok).length;
      if (ok === res.length) toast.success(t("operator.doneAll", { n: String(ok) }));
      else toast.error(t("operator.donePartial", { ok: String(ok), n: String(res.length) }));
      router.refresh();
    });

  const reset = () => {
    setPlan(null);
    setResults(null);
    setText("");
  };

  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  const resultOf = (n: number) => results?.find((r) => r.n === n);

  return (
    <div className="space-y-4" data-testid="operator">
      {/* composer */}
      <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -end-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative mb-3 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-solid text-accent-fg shadow-md">
            <Zap className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold">{t("operator.composeTitle")}</h2>
            <p className="text-[12.5px] text-muted">{t("operator.composeHint")}</p>
          </div>
        </div>
        <label htmlFor="operator-input" className="sr-only">
          {t("operator.composeTitle")}
        </label>
        <Textarea
          id="operator-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim().length >= 3) {
              e.preventDefault();
              makePlan();
            }
          }}
          placeholder={t("operator.placeholder")}
          dir="auto"
          className="relative min-h-[88px] resize-y bg-surface"
          data-testid="operator-input"
        />
        <div className="relative mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={makePlan} loading={pending && !plan} disabled={text.trim().length < 3 || pending} data-testid="operator-plan">
            <Sparkles className="h-4 w-4" aria-hidden /> {t("operator.plan")}
          </Button>
          {canSpeak ? (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={listening}
              className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition", listening ? "border-danger bg-danger-soft text-danger" : "border-line hover:bg-surface-hover")}
            >
              {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              {listening ? t("operator.stopVoice") : t("operator.voice")}
            </button>
          ) : null}
          {plan ? (
            <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] text-muted hover:bg-surface-hover">
              <RotateCcw className="h-4 w-4" aria-hidden /> {t("operator.reset")}
            </button>
          ) : null}
          <span className="ms-auto hidden text-[11.5px] text-subtle sm:inline">{t("operator.shortcut")}</span>
        </div>
        {!plan ? (
          <div className="relative mt-3 flex flex-wrap gap-1.5" aria-label={t("operator.examplesTitle")}>
            {OP_EXAMPLES.map((k) => (
              <button key={k} type="button" onClick={() => setText(t(`operator.examples.${k}`))} className="lift rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-muted hover:border-accent hover:text-fg">
                {t(`operator.exampleChip.${k}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* plan */}
      {plan ? (
        <section className="pulse-in space-y-3" aria-label={t("operator.planTitle")} data-testid="operator-plan-view">
          {plan.reply ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3 shadow-sm">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p className="text-[13.5px]" dir="auto">
                {plan.reply}
              </p>
            </div>
          ) : null}
          {plan.actions.length ? (
            <ol className="stagger space-y-2">
              {plan.actions.map((a) => {
                const Icon = ICON[a.tool];
                const res = resultOf(a.n);
                const isBlocked = blocked(a);
                const shown = SHOW_ARGS.filter((k) => a.args[k] !== undefined && String(a.args[k]).trim());
                return (
                  <li key={a.n} className={cn("rounded-2xl border bg-surface p-3 shadow-sm transition", res ? (res.ok ? "border-success/50" : "border-danger/50") : include[a.n] && !isBlocked ? "border-accent/40" : "border-line opacity-80")} data-testid={`operator-action-${a.tool}`}>
                    <div className="flex items-start gap-3">
                      {!res ? (
                        <input
                          type="checkbox"
                          className="mt-1.5 h-4 w-4 accent-[var(--accent-solid)]"
                          checked={Boolean(include[a.n]) && !isBlocked}
                          disabled={isBlocked || pending}
                          onChange={(e) => setInclude((cur) => ({ ...cur, [a.n]: e.target.checked }))}
                          aria-label={t(`operator.tool.${a.tool}`)}
                        />
                      ) : res.ok ? (
                        <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <XCircle className="mt-1 h-5 w-5 shrink-0 text-danger" aria-hidden />
                      )}
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-[13.5px] font-semibold">
                          <span className="me-1.5 text-subtle tabular-nums">{a.n}.</span>
                          {t(`operator.tool.${a.tool}`)}
                        </p>
                        {shown.length ? (
                          <dl className="grid gap-x-3 gap-y-0.5 text-[12.5px] sm:grid-cols-[auto_1fr]">
                            {shown.map((k) => (
                              <div key={k} className="contents">
                                <dt className="text-muted">{t(`operator.arg.${k}`)}</dt>
                                <dd className="min-w-0 whitespace-pre-wrap break-words" dir="auto">
                                  {String(a.args[k]).slice(0, 600)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {a.contact ? (
                            a.contact.ref ? (
                              <Badge tone="accent">{t("operator.chip.newContact", { n: String(a.contact.ref) })}</Badge>
                            ) : a.contact.candidates.length > 1 && !a.contact.id ? (
                              <Select
                                aria-label={t("operator.chooseContact")}
                                className="h-8 max-w-[16rem] text-[12.5px]"
                                value={chosen[`contact:${a.n}`] ?? ""}
                                onChange={(e) => setChosen((c) => ({ ...c, [`contact:${a.n}`]: e.target.value }))}
                              >
                                <option value="">{t("operator.chooseContact")}</option>
                                {a.contact.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label}
                                    {c.sub ? ` · ${c.sub}` : ""}
                                  </option>
                                ))}
                              </Select>
                            ) : a.contact.id ? (
                              <Badge tone="success">
                                <UserCog className="h-3 w-3" aria-hidden /> {a.contact.label}
                              </Badge>
                            ) : (
                              <Badge tone="warning">{t("operator.chip.contactMissing", { name: a.contact.label })}</Badge>
                            )
                          ) : null}
                          {a.deal ? (
                            a.deal.id ? (
                              <Badge tone="success">
                                <Kanban className="h-3 w-3" aria-hidden /> {a.deal.label}
                              </Badge>
                            ) : a.deal.candidates.length ? (
                              <Select aria-label={t("operator.chooseDeal")} className="h-8 max-w-[16rem] text-[12.5px]" value={chosen[`deal:${a.n}`] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [`deal:${a.n}`]: e.target.value }))}>
                                <option value="">{t("operator.chooseDeal")}</option>
                                {a.deal.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label}
                                  </option>
                                ))}
                              </Select>
                            ) : null
                          ) : null}
                          {a.task ? (
                            a.task.id ? (
                              <Badge tone="success">
                                <ClipboardCheck className="h-3 w-3" aria-hidden /> {a.task.label}
                              </Badge>
                            ) : a.task.candidates.length ? (
                              <Select aria-label={t("operator.chooseTask")} className="h-8 max-w-[16rem] text-[12.5px]" value={chosen[`task:${a.n}`] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [`task:${a.n}`]: e.target.value }))}>
                                <option value="">{t("operator.chooseTask")}</option>
                                {a.task.candidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label}
                                  </option>
                                ))}
                              </Select>
                            ) : null
                          ) : null}
                          {a.assignee ? (
                            <Badge tone="teal">
                              <UserCog className="h-3 w-3" aria-hidden /> {a.assignee.label}
                            </Badge>
                          ) : null}
                          {a.stage ? <Badge tone="gold">{a.stage.label}</Badge> : null}
                          {a.whenIso ? (
                            <Badge tone="accent">
                              <Clock className="h-3 w-3" aria-hidden /> {fmtWhen(a.whenIso)}
                            </Badge>
                          ) : null}
                        </div>
                        {a.warnings.length ? (
                          <ul className="space-y-0.5">
                            {a.warnings.map((w) => (
                              <li key={w} className="flex items-center gap-1.5 text-[12px] text-warning">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {t(`operator.warn.${w}`)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {res ? (
                          <p className={cn("flex flex-wrap items-center gap-2 text-[12.5px] font-medium", res.ok ? "text-success" : "text-danger")}>
                            {res.ok ? t("operator.resultOk") : t(res.error ?? "errors.generic")}
                            {res.ok && res.link ? (
                              <Link href={`/${locale}${res.link}`} className="font-semibold text-accent hover:underline">
                                {t("operator.open")}
                              </Link>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {plan.dropped > 0 ? <p className="text-[12px] text-muted">{t("operator.dropped", { n: String(plan.dropped) })}</p> : null}
          {plan.actions.length && !results ? (
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
              <span className="text-[13px] text-muted">{t("operator.selected", { n: String(selected.length), total: String(plan.actions.length) })}</span>
              <Button className="ms-auto" onClick={execute} loading={pending} disabled={!selected.length} data-testid="operator-execute">
                <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {t("operator.execute", { n: String(selected.length) })}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* history */}
      <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm" aria-label={t("operator.historyTitle")}>
        <h2 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold">
          <FileText className="h-4 w-4 text-accent" aria-hidden /> {t("operator.historyTitle")}
        </h2>
        {history.length ? (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-3 py-2.5">
                {h.status === "executed" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : h.status === "partial" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                ) : h.status === "failed" ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px]" dir="auto">
                    {h.instruction}
                  </p>
                  <p className="text-[11.5px] text-muted">
                    {t(`operator.status.${h.status}`)} · {t("operator.actionsCount", { n: String(h.count) })} · {fmtWhen(h.created_at)}
                  </p>
                </div>
                <button type="button" onClick={() => setText(h.instruction)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-accent hover:bg-accent-soft">
                  {t("operator.reuse")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{t("operator.historyEmpty")}</p>
        )}
      </section>
    </div>
  );
}
