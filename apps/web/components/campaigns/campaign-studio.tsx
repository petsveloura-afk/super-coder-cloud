"use client";

import { useMemo, useState, useSyncExternalStore, useTransition, type CSSProperties } from "react";
import { toast } from "sonner";
import { AtSign, Check, CircleAlert, CircleCheck, CircleX, Clock, Languages, Rocket, Sparkles, Undo2, Wand2, Smartphone, Mail, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui/primitives";
import { aiImproveMessageAction, aiSubjectIdeasAction, aiWriteCampaignAction } from "@/app/[locale]/(dashboard)/campaigns/actions";
import { AUDIENCE_PRESETS, analyzeMessage, readiness, renderPreview, suggestSendTimes, type Channel, type CheckLevel, type ReadinessInput, type ScoreLevel } from "@/lib/campaigns/brain";
import { GOALS, TONES, type ImproveMode, type WriterVariant } from "@/lib/campaigns/ai-core";
import { cn } from "@/lib/utils";

const LEVEL_COLOR: Record<ScoreLevel, string> = { excellent: "var(--success)", good: "var(--teal)", fair: "var(--warning)", weak: "var(--danger)" };
const LEVEL_BADGE: Record<ScoreLevel, "success" | "teal" | "warning" | "danger"> = { excellent: "success", good: "teal", fair: "warning", weak: "danger" };
const CHECK_ICON: Record<CheckLevel, typeof Check> = { ok: CircleCheck, warn: CircleAlert, bad: CircleX };
const CHECK_COLOR: Record<CheckLevel, string> = { ok: "text-success", warn: "text-warning", bad: "text-danger" };

/* ------------------------------------------------------------------ ring */
export function ScoreRing({ score, level, size = 68, label }: { score: number; level: ScoreLevel; size?: number; label?: string }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const off = len * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? String(score)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle className="health-ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LEVEL_COLOR[level]} strokeWidth={stroke} strokeLinecap="round" style={{ "--ring-len": len, "--ring-off": off } as CSSProperties} />
      </svg>
      <span className="absolute text-[17px] font-bold tabular-nums" style={{ color: LEVEL_COLOR[level] }}>
        {score}
      </span>
    </span>
  );
}

const SAMPLE: Record<string, { first_name: string }> = { he: { first_name: "דנה" }, ar: { first_name: "سارة" }, en: { first_name: "Dana" } };

/* ------------------------------------------------------- message studio */
export function MessageStudio({
  channel,
  subject,
  body,
  hasTemplate,
  onChange,
}: {
  channel: Channel;
  subject: string;
  body: string;
  hasTemplate: boolean;
  onChange: (patch: { subject?: string; body?: string }) => void;
}) {
  const { t, locale } = useI18n();
  const [tone, setTone] = useState<(typeof TONES)[number]>("friendly");
  const [goal, setGoal] = useState<(typeof GOALS)[number]>("promo");
  const [offer, setOffer] = useState("");
  const [variants, setVariants] = useState<WriterVariant[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ subject: string; body: string } | null>(null);
  const [writing, startWrite] = useTransition();
  const [improving, startImprove] = useTransition();
  const [subjecting, startSubject] = useTransition();
  const [busyMode, setBusyMode] = useState<string | null>(null);

  const a = useMemo(() => analyzeMessage({ channel, subject, body, hasTemplate }), [channel, subject, body, hasTemplate]);
  const orgSample = t("campaigns.studio.sampleOrg");
  const shown = renderPreview(body, { first_name: SAMPLE[locale]?.first_name ?? "Dana", org: orgSample });
  const shownSubject = renderPreview(subject, { first_name: SAMPLE[locale]?.first_name ?? "Dana", org: orgSample });

  function apply(patch: { subject?: string; body?: string }) {
    setUndo({ subject, body });
    onChange(patch);
  }

  function insert(token: string) {
    const el = document.getElementById("cp-body") as HTMLTextAreaElement | null;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    apply({ body: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function improve(mode: ImproveMode) {
    setBusyMode(mode);
    startImprove(async () => {
      const res = await aiImproveMessageAction({ locale, mode, channel, subject, body });
      setBusyMode(null);
      if (res.error || !res.data) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      apply({ body: res.data.body, ...(channel === "email" && res.data.subject ? { subject: res.data.subject } : {}) });
      toast.success(t(res.message ?? "campaigns.ai.improved"));
    });
  }

  function write() {
    startWrite(async () => {
      const res = await aiWriteCampaignAction({ locale, channel, goal, tone, offer });
      if (res.error || !res.data) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      setVariants(res.data.variants);
      toast.success(t(res.message ?? "campaigns.ai.writerReady"));
    });
  }

  function ideas() {
    startSubject(async () => {
      const res = await aiSubjectIdeasAction({ locale, body, tone });
      if (res.error || !res.data) {
        toast.error(t(res.error ?? "errors.generic"));
        return;
      }
      setSubjects(res.data.subjects);
    });
  }

  const hasBody = body.trim().length > 2;
  const MODES: { mode: ImproveMode; icon: typeof Wand2 }[] = [
    { mode: "shorter", icon: Wand2 },
    { mode: "friendlier", icon: Sparkles },
    { mode: "urgent", icon: Zap },
    { mode: "formal", icon: AtSign },
    { mode: "add_cta", icon: Rocket },
    { mode: "fix_spam", icon: CircleCheck },
  ];

  return (
    <div className="space-y-4" data-testid="message-studio">
      {/* AI writer */}
      <details className="rounded-xl border border-accent/30 bg-accent-soft/30 p-3" open={!hasBody}>
        <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
          <Sparkles className="h-4 w-4 text-accent" /> {t("campaigns.studio.writer")}
          <span className="ms-auto text-[11.5px] font-normal text-subtle">{t("campaigns.studio.writerHint")}</span>
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t("campaigns.studio.goal")} htmlFor="cp-goal">
            <Select id="cp-goal" value={goal} onChange={(e) => setGoal(e.target.value as typeof goal)}>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {t(`campaigns.studio.goals.${g}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("campaigns.studio.tone")} htmlFor="cp-tone">
            <Select id="cp-tone" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
              {TONES.map((x) => (
                <option key={x} value={x}>
                  {t(`campaigns.studio.tones.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("campaigns.studio.offer")} htmlFor="cp-offer">
            <Input id="cp-offer" value={offer} onChange={(e) => setOffer(e.target.value.slice(0, 400))} placeholder={t("campaigns.studio.offerPlaceholder")} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={write} loading={writing} data-testid="ai-write">
            <Sparkles className="h-4 w-4" /> {t("campaigns.studio.writeThree")}
          </Button>
          {undo ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange({ subject: undo.subject, body: undo.body });
                setUndo(null);
              }}
            >
              <Undo2 className="h-4 w-4" /> {t("campaigns.studio.undo")}
            </Button>
          ) : null}
        </div>
        {variants.length ? (
          <ul className="mt-3 grid gap-3 lg:grid-cols-3" data-testid="ai-variants">
            {variants.map((v, i) => (
              <li key={`${v.angle}-${i}`} className="fade-slide flex flex-col rounded-xl border border-line bg-surface p-3" style={{ animationDelay: `${i * 70}ms` }}>
                <Badge tone="accent" className="mb-2 self-start">
                  {v.angle}
                </Badge>
                {v.subject ? <div className="mb-1 text-[13px] font-semibold">{v.subject}</div> : null}
                <p className="line-clamp-6 flex-1 whitespace-pre-wrap text-[12.5px] text-muted">{v.body}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 self-start"
                  onClick={() => {
                    apply({ body: v.body, ...(channel === "email" && v.subject ? { subject: v.subject } : {}) });
                    toast.success(t("campaigns.studio.applied"));
                  }}
                >
                  <Check className="h-4 w-4" /> {t("campaigns.studio.use")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      {/* quick actions */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="message-tools">
        <span className="me-1 text-[12px] font-medium text-subtle">{t("campaigns.studio.insert")}</span>
        <button type="button" onClick={() => insert("{{contact.first_name}}")} className="rounded-full border border-line px-2.5 py-1 text-[12px] hover:bg-surface-hover" dir="ltr">
          {t("campaigns.studio.varFirstName")}
        </button>
        <button type="button" onClick={() => insert("{{org.name}}")} className="rounded-full border border-line px-2.5 py-1 text-[12px] hover:bg-surface-hover" dir="ltr">
          {t("campaigns.studio.varOrg")}
        </button>
        <button type="button" onClick={() => insert(`\n\n${t("campaigns.studio.optOutLine")}`)} className="rounded-full border border-line px-2.5 py-1 text-[12px] hover:bg-surface-hover">
          {t("campaigns.studio.addOptOut")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[12px] font-medium text-subtle">{t("campaigns.studio.improve")}</span>
        {MODES.map(({ mode, icon: Icon }) => (
          <Button key={mode} variant="secondary" size="sm" disabled={!hasBody || improving} loading={improving && busyMode === mode} onClick={() => improve(mode)}>
            <Icon className="h-3.5 w-3.5" /> {t(`campaigns.studio.modes.${mode}`)}
          </Button>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5 text-subtle" aria-hidden />
          <Select
            aria-label={t("campaigns.studio.translate")}
            value=""
            disabled={!hasBody || improving}
            onChange={(e) => {
              if (e.target.value) improve(e.target.value as ImproveMode);
            }}
            className="h-8 w-auto py-0 text-[13px]"
          >
            <option value="">{t("campaigns.studio.translate")}</option>
            <option value="translate_he">{t("campaigns.studio.modes.translate_he")}</option>
            <option value="translate_ar">{t("campaigns.studio.modes.translate_ar")}</option>
            <option value="translate_en">{t("campaigns.studio.modes.translate_en")}</option>
          </Select>
        </span>
        {channel === "email" ? (
          <Button variant="secondary" size="sm" disabled={!hasBody} loading={subjecting} onClick={ideas}>
            <Mail className="h-3.5 w-3.5" /> {t("campaigns.studio.subjectIdeas")}
          </Button>
        ) : null}
      </div>
      {subjects.length ? (
        <ul className="flex flex-wrap gap-1.5" data-testid="subject-ideas">
          {subjects.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  apply({ subject: s });
                  toast.success(t("campaigns.studio.applied"));
                }}
                className="rounded-full border border-accent/40 bg-accent-soft/40 px-3 py-1 text-[12.5px] hover:bg-accent-soft"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* score + live preview */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="rounded-xl border border-line p-4" data-testid="message-score">
          <div className="flex items-center gap-4">
            <ScoreRing score={a.score} level={a.level} label={t("campaigns.studio.scoreLabel", { score: a.score })} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t("campaigns.studio.quality")}</span>
                <Badge tone={LEVEL_BADGE[a.level]}>{t(`campaigns.studio.levels.${a.level}`)}</Badge>
              </div>
              <p className="mt-0.5 text-[12px] text-subtle">
                {t("campaigns.studio.stats", { words: a.words, chars: a.chars, secs: a.readingSeconds })}
                {a.segments ? ` · ${t("campaigns.studio.segments", { count: a.segments.segments, per: a.segments.perSegment })}` : ""}
              </p>
            </div>
          </div>
          <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {a.checks.map((c) => {
              const Icon = CHECK_ICON[c.level];
              const hintKey = c.id === "length" ? (c.params?.min !== undefined ? "length_short" : "length_long") : c.id;
              return (
                <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", CHECK_COLOR[c.level])} aria-hidden />
                  <span className={c.level === "ok" ? "text-muted" : "text-fg"}>
                    {c.level === "ok" ? t(`campaigns.studio.checks.${c.id}`) : t(`campaigns.studio.hints.${hintKey}`, { count: Number(c.params?.count ?? 0), min: Number(c.params?.min ?? 0), max: Number(c.params?.max ?? 0) })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-surface-hover/40 p-4" data-testid="message-preview" aria-label={t("campaigns.studio.preview")}>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-subtle">
            {channel === "email" ? <Mail className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />} {t("campaigns.studio.preview")}
          </div>
          {channel === "email" ? (
            <div className="overflow-hidden rounded-lg border border-line bg-surface text-[12.5px]">
              <div className="border-b border-line px-3 py-2">
                <div className="truncate font-semibold">{shownSubject || t("campaigns.studio.noSubject")}</div>
                <div className="text-[11px] text-subtle">{orgSample}</div>
              </div>
              <p className="max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2.5 text-muted">{shown || t("campaigns.studio.emptyPreview")}</p>
            </div>
          ) : (
            <div className="rounded-2xl bg-[#e7f3ee] p-3 dark:bg-[#12312a]">
              <div className="ms-0 max-w-[92%] rounded-2xl rounded-ss-sm bg-surface px-3 py-2 text-[12.5px] shadow-sm">
                <p className="max-h-56 overflow-auto whitespace-pre-wrap">{shown || t("campaigns.studio.emptyPreview")}</p>
                <div className="mt-1 text-end text-[10.5px] text-subtle" aria-hidden>
                  {t(`campaigns.channels.${channel}`)}
                </div>
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-subtle">{t("campaigns.studio.previewNote")}</p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- audience presets */
type Aud = Record<string, unknown>;
export function AudiencePresets({ audience, onPick }: { audience: Aud; onPick: (next: Aud) => void }) {
  const { t } = useI18n();
  const isOn = (p: Aud) => Object.entries(p).every(([k, v]) => audience[k] === v);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="audience-presets">
      <span className="me-1 text-[12px] font-medium text-subtle">{t("campaigns.studio.quickAudience")}</span>
      {AUDIENCE_PRESETS.map((p) => {
        const on = isOn(p.audience as Aud);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next: Aud = { ...audience };
              if (on) for (const k of Object.keys(p.audience)) delete next[k];
              else Object.assign(next, p.audience);
              onPick(next);
            }}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium transition", on ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}
          >
            {t(`campaigns.studio.presets.${p.id}`)}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- send-time ideas */
export function SendTimeChips({ channel, onPick }: { channel: Channel; onPick: (iso: string) => void }) {
  const { t, locale } = useI18n();
  // times depend on "now": computed on the client only, so server and browser never disagree during hydration
  const client = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const slots = useMemo(() => (client ? suggestSendTimes(channel) : []), [client, channel]);
  if (!slots.length) return null;
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="send-times">
      <span className="me-1 inline-flex items-center gap-1 text-[12px] font-medium text-subtle">
        <Clock className="h-3.5 w-3.5" /> {t("campaigns.studio.bestTimes")}
      </span>
      {slots.map((s) => (
        <button key={s.at.toISOString()} type="button" onClick={() => onPick(s.at.toISOString())} className="rounded-full border border-line px-3 py-1 text-[12.5px] hover:bg-surface-hover" title={t(`campaigns.studio.sendReasons.${s.reason}`)}>
          {fmt.format(s.at)}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ readiness */
export function ReadinessPanel(props: Omit<ReadinessInput, "messageScore"> & { subject: string }) {
  const { t } = useI18n();
  const msg = useMemo(() => analyzeMessage({ channel: props.channel, subject: props.subject, body: props.body, hasTemplate: props.hasTemplate }), [props.channel, props.subject, props.body, props.hasTemplate]);
  const r = useMemo(() => readiness({ ...props, messageScore: msg.score }), [props, msg.score]);
  const blockers = r.items.filter((x) => x.level === "bad").length;
  return (
    <Card className="p-5" data-testid="readiness">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Rocket className="h-4 w-4 text-accent" /> {t("campaigns.studio.readiness")}
        </h2>
        <Badge tone={r.ready ? "success" : blockers ? "danger" : "warning"}>{r.ready ? t("campaigns.studio.ready") : blockers ? t("campaigns.studio.blockers", { count: blockers }) : t("campaigns.studio.almost")}</Badge>
        <span className="ms-auto text-[12.5px] tabular-nums text-subtle">{r.percent}%</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent}>
        <span className={cn("bar-fill block h-full rounded-full", r.ready ? "bg-success" : "bg-accent-solid")} style={{ "--w": `${r.percent}%` } as CSSProperties} />
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {r.items.map((x) => {
          const Icon = CHECK_ICON[x.level];
          return (
            <li key={x.id} className="flex items-start gap-2 text-[13px]">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", CHECK_COLOR[x.level])} aria-hidden />
              <span>{t(`campaigns.studio.ready_${x.id}`, { count: Number(x.params?.count ?? 0), score: Number(x.params?.score ?? 0) })}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
