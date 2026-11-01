"use client";

import { useMemo, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, CalendarRange, Clapperboard, Flame, Image as ImageIcon, Lightbulb, Quote, RefreshCw, Repeat2, Send, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { upcomingHolidays, type AutopilotSettings, type Learned } from "@/lib/social/brain-core";
import type { DeepLearned } from "@/lib/social/brain-plus-core";
import { ctaLabel, type CtaType } from "@/lib/social/post-core";
import { planWeekAction, recyclePostAction, refreshBrainAction, saveAutopilotAction, smartPostNowAction, testTelegramChannelAction } from "@/app/[locale]/(dashboard)/social/brain-actions";

/**
 * Wave 61 — the social brain tab: a daily post on autopilot (text + picture or video), one-click "next post"
 * and "plan my week", what the brain learned from real engagement, holidays ahead, reviews → posts,
 * top posts to recycle, and a Telegram channel as an extra destination.
 */
export interface BrainTopPost {
  id: string;
  body: string;
  engagement: number;
  image_url: string | null;
}
export interface BrainReview {
  id: string;
  author: string | null;
  body: string;
  rating: number | null;
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const CTA = ["", "message", "whatsapp", "call", "book", "learn_more", "shop", "order"];

function Tilt({ children, className }: { children: React.ReactNode; className?: string }) {
  const [style, setStyle] = useState<CSSProperties>({});
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setStyle({ transform: `perspective(900px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)` });
  };
  return (
    <div onPointerMove={move} onPointerLeave={() => setStyle({})} style={style} className={cn("transition-transform duration-200 ease-out will-change-transform motion-reduce:transform-none", className)}>
      {children}
    </div>
  );
}

function Bar({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="truncate font-medium" dir="auto">
          {label}
        </span>
        <span className="text-subtle">{hint ?? value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-elevated">
        <div className="h-full rounded-full bg-gradient-to-l from-accent-solid to-teal" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

export function BrainPanel(p: { onCreated?: (id: string) => void; onShowPost?: (id: string) => void; settings: AutopilotSettings; learned: Learned | null; topPosts: BrainTopPost[]; reviews: BrainReview[]; facebook: boolean; instagram: boolean; telegramBot: boolean; videoReady: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [s, setS] = useState(p.settings);
  const [pillars, setPillars] = useState(p.settings.pillars.join("\n"));
  const [tags, setTags] = useState(p.settings.hashtags.join(" "));
  const [topic, setTopic] = useState("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const set = <K extends keyof AutopilotSettings>(k: K, v: AutopilotSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const holidays = useMemo(() => upcomingHolidays(today, 45).slice(0, 4), [today]);
  // W1-B1: real progress stages while the post is written and illustrated, and the result opens right away
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState<{ key: string; retry: () => void; message: string } | null>(null);
  const run = (key: string, fn: () => Promise<{ error?: string; message?: string; messageParams?: Record<string, string | number>; data?: unknown }>) =>
    start(async () => {
      setBusy(key);
      setFailed(null);
      setStage(0);
      const timers = [setTimeout(() => setStage(1), 6000), setTimeout(() => setStage(2), 16000)];
      try {
        const r = await fn();
        if (r.error) {
          toast.error(t(r.error, r.messageParams));
          setFailed({ key, retry: () => run(key, fn), message: t(r.error, r.messageParams) });
        } else {
          const id = (r.data as { id?: string } | undefined)?.id;
          if (id) {
            toast.success(t(r.message ?? "common.saved", r.messageParams), { action: p.onShowPost ? { label: t("social.drawer.show"), onClick: () => p.onShowPost?.(id) } : undefined });
            p.onCreated?.(id);
          } else toast.success(t(r.message ?? "common.saved", r.messageParams));
          router.refresh();
        }
      } finally {
        timers.forEach(clearTimeout);
        setBusy(null);
      }
    });
  const save = (enabled = s.enabled) =>
    run("save", () =>
      saveAutopilotAction({
        locale,
        enabled,
        mode: s.mode,
        post_time: s.post_time,
        days: s.days,
        platforms: s.platforms,
        media: s.media,
        style: s.style,
        tone: s.tone,
        pillars,
        hashtags: tags,
        avoid: s.avoid ?? "",
        cta_type: s.cta_type ?? "",
        cta_value: s.cta_value ?? "",
        holidays: s.holidays,
        reviews_to_posts: s.reviews_to_posts,
        telegram_chat: s.telegram_chat ?? "",
      }),
    );
  const l = p.learned;
  const pillarRows = l ? Object.entries(l.pillarScores).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const mediaRows = l ? Object.entries(l.mediaScores).sort((a, b) => b[1] - a[1]) : [];
  const maxP = Math.max(1, ...pillarRows.map((x) => x[1]), ...mediaRows.map((x) => x[1]));
  const dayName = (d: number) => new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "short", timeZone: "UTC" });

  return (
    <div className="space-y-4" data-testid="brain-panel">
      {/* hero */}
      <Tilt>
        <div className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent-soft via-surface to-teal-soft p-5 shadow-sm sm:p-6">
          <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-accent-solid/20 blur-3xl motion-safe:animate-pulse" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 start-10 h-48 w-48 rounded-full bg-teal/20 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-solid text-accent-fg shadow-lg shadow-accent-solid/30 [transform:translateZ(30px)]">
              <BrainCircuit className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold sm:text-xl">{t("social.brain.title")}</h2>
              <p className="mt-1 text-[13.5px] text-muted">{t("social.brain.subtitle")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                <Badge tone={p.settings.enabled ? "success" : "neutral"}>{t(p.settings.enabled ? "social.brain.on" : "social.brain.off")}</Badge>
                {p.settings.enabled ? (
                  <Badge tone="accent">
                    {t("social.brain.dailyAt", { time: p.settings.post_time })} · {t(p.settings.mode === "auto" ? "social.brain.modeAuto" : "social.brain.modeDraft")}
                  </Badge>
                ) : null}
                {l && l.posts >= 3 ? <Badge tone="neutral">{t("social.brain.learnedFrom", { n: l.posts })}</Badge> : <Badge tone="neutral">{t("social.brain.learning")}</Badge>}
                {p.settings.last_error ? <Badge tone="warning">{t("social.brain.lastError")}</Badge> : null}
              </div>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {!p.settings.enabled ? (
                <Button onClick={() => save(true)} loading={busy === "save"} data-testid="brain-enable">
                  <Sparkles className="h-4 w-4" /> {t("social.brain.enable")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => save(false)} loading={busy === "save"}>
                  {t("social.brain.pause")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Tilt>

      {/* one-click actions */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <Wand2 className="h-4 w-4 text-accent" /> {t("social.brain.nowTitle")}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">{t("social.brain.nowBody")}</p>
          <Input className="mt-2" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("social.brain.topicPh")} aria-label={t("social.brain.topicPh")} dir="auto" maxLength={300} />
          <Button className="mt-2 w-full" onClick={() => run("now", () => smartPostNowAction({ locale, topic }))} loading={busy === "now"} disabled={pending && busy !== "now"} data-testid="brain-now">
            <Sparkles className="h-4 w-4" /> {t("social.brain.nowBtn")}
          </Button>
          {busy === "now" ? (
            <ol className="mt-2 space-y-1 text-[12px]" aria-live="polite" data-testid="brain-stages">
              {["social.drawer.stageText", "social.drawer.stageMedia", "social.drawer.stageSave"].map((k, i) => (
                <li key={k} className={cn("flex items-center gap-1.5", i < stage ? "text-success" : i === stage ? "font-semibold text-accent" : "text-subtle")}>
                  <span aria-hidden>{i < stage ? "✓" : i === stage ? "•" : "○"}</span> {t(k)}
                </li>
              ))}
            </ol>
          ) : null}
          {failed?.key === "now" && busy !== "now" ? (
            <div className="mt-2 rounded-xl border border-danger/30 bg-danger-soft/40 p-2 text-[12px]" role="alert">
              <p className="text-danger">{failed.message}</p>
              <Button size="sm" variant="secondary" className="mt-1.5" onClick={failed.retry}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <CalendarRange className="h-4 w-4 text-accent" /> {t("social.brain.weekTitle")}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">{t("social.brain.weekBody")}</p>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => run("week", () => planWeekAction({ locale, count: 7 }))} loading={busy === "week"} disabled={pending && busy !== "week"} data-testid="brain-week">
            <CalendarRange className="h-4 w-4" /> {t("social.brain.weekBtn")}
          </Button>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <RefreshCw className="h-4 w-4 text-accent" /> {t("social.brain.learnTitle")}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">{t("social.brain.learnBody")}</p>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => run("learn", () => refreshBrainAction({ locale }))} loading={busy === "learn"} disabled={pending && busy !== "learn"}>
            <RefreshCw className="h-4 w-4" /> {t("social.brain.learnBtn")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* settings */}
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-4 xl:col-span-3" data-testid="brain-settings">
          <p className="font-semibold">{t("social.brain.settingsTitle")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[13px]">
              <span className="block font-medium text-muted">{t("social.brain.time")}</span>
              <Input type="time" value={s.post_time} onChange={(e) => set("post_time", e.target.value)} dir="ltr" />
            </label>
            <label className="space-y-1.5 text-[13px]">
              <span className="block font-medium text-muted">{t("social.brain.mode")}</span>
              <Select value={s.mode} onChange={(e) => set("mode", e.target.value === "auto" ? "auto" : "draft")}>
                <option value="draft">{t("social.brain.modeDraft")}</option>
                <option value="auto">{t("social.brain.modeAuto")}</option>
              </Select>
            </label>
          </div>
          <div className="space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.days")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("social.brain.days")}>
              {DAYS.map((d) => (
                <button key={d} type="button" aria-pressed={s.days.includes(d)} onClick={() => set("days", s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort())} className={cn("min-w-11 rounded-full border px-3 py-1 text-[13px] transition", s.days.includes(d) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-hover")}>
                  {dayName(d)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.where")}</span>
            <div className="flex flex-wrap gap-4">
              {(["facebook", "instagram"] as const).map((pl) => (
                <label key={pl} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={s.platforms.includes(pl)} onChange={(e) => set("platforms", e.target.checked ? [...new Set([...s.platforms, pl])] : s.platforms.filter((x) => x !== pl))} />
                  {pl === "facebook" ? "Facebook" : "Instagram"}
                  {(pl === "facebook" ? p.facebook : p.instagram) ? null : <span className="text-[11.5px] text-subtle">({t("social.brain.notConnected")})</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.media")}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("social.brain.media")}>
              {(["image", "video", "mix", "none"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={s.media === m} onClick={() => set("media", m)} className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[12.5px] transition", s.media === m ? "border-accent bg-accent-soft text-accent shadow-sm" : "border-line text-muted hover:bg-surface-hover")}>
                  {m === "image" ? <ImageIcon className="h-4 w-4" /> : m === "video" ? <Clapperboard className="h-4 w-4" /> : m === "mix" ? <Repeat2 className="h-4 w-4" /> : <Quote className="h-4 w-4" />}
                  {t(`social.brain.media_${m}`)}
                </button>
              ))}
            </div>
            {(s.media === "video" || s.media === "mix") && !p.videoReady ? <p className="text-[12px] text-warning">{t("social.brain.videoNeedsKey")}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[13px]">
              <span className="block font-medium text-muted">{t("social.brain.style")}</span>
              <Select value={s.style} onChange={(e) => set("style", e.target.value)}>
                {["auto", "photo", "cinematic", "illustration", "3d", "minimal", "flatlay"].map((x) => (
                  <option key={x} value={x}>
                    {t(`social.brain.style_${x}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5 text-[13px]">
              <span className="block font-medium text-muted">{t("social.brain.tone")}</span>
              <Select value={s.tone} onChange={(e) => set("tone", e.target.value)}>
                {["friendly", "professional", "playful", "premium"].map((x) => (
                  <option key={x} value={x}>
                    {t(`social.brain.tone_${x}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="block space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.pillars")}</span>
            <Textarea rows={3} value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder={t("social.brain.pillarsPh")} dir="auto" />
            <span className="block text-[12px] text-subtle">{t("social.brain.pillarsHint")}</span>
          </label>
          <label className="block space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.hashtags")}</span>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#העסק_שלי #טיפים" dir="auto" />
          </label>
          <label className="block space-y-1.5 text-[13px]">
            <span className="block font-medium text-muted">{t("social.brain.avoid")}</span>
            <Input value={s.avoid ?? ""} onChange={(e) => set("avoid", e.target.value)} placeholder={t("social.brain.avoidPh")} dir="auto" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[13px]">
              <span className="block font-medium text-muted">{t("social.brain.cta")}</span>
              <Select value={s.cta_type ?? ""} onChange={(e) => set("cta_type", e.target.value || null)}>
                {CTA.map((c) => (
                  <option key={c || "none"} value={c}>
                    {c ? ctaLabel(c as CtaType, locale) : t("social.brain.ctaNone")}
                  </option>
                ))}
              </Select>
            </label>
            {s.cta_type ? (
              <label className="space-y-1.5 text-[13px]">
                <span className="block font-medium text-muted">{t("social.brain.ctaValue")}</span>
                <Input value={s.cta_value ?? ""} onChange={(e) => set("cta_value", e.target.value)} dir="ltr" placeholder="https://… / 05…" />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={s.holidays} onChange={(e) => set("holidays", e.target.checked)} /> {t("social.brain.holidays")}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={s.reviews_to_posts} onChange={(e) => set("reviews_to_posts", e.target.checked)} /> {t("social.brain.reviews")}
            </label>
          </div>
          <div className="space-y-1.5 rounded-xl border border-dashed border-line p-3 text-[13px]">
            <span className="flex items-center gap-1.5 font-medium">
              <Send className="h-4 w-4 text-accent rtl:-scale-x-100" /> {t("social.brain.telegram")}
            </span>
            <span className="block text-[12px] text-subtle">{t(p.telegramBot ? "social.brain.telegramHint" : "social.brain.noBot")}</span>
            <div className="flex flex-wrap gap-2">
              <Input className="h-9 min-w-0 flex-1" value={s.telegram_chat ?? ""} onChange={(e) => set("telegram_chat", e.target.value)} placeholder="@my_channel" dir="ltr" aria-label={t("social.brain.telegram")} disabled={!p.telegramBot} />
              <Button size="sm" variant="secondary" disabled={!p.telegramBot || !s.telegram_chat || pending} loading={busy === "tg"} onClick={() => run("tg", () => testTelegramChannelAction({ locale, chat: s.telegram_chat ?? "" }))}>
                {t("social.brain.test")}
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => save()} loading={busy === "save"} data-testid="brain-save">
              {t("common.save")}
            </Button>
          </div>
        </div>

        {/* what the brain knows */}
        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-line bg-surface p-4" data-testid="brain-insights">
            <p className="flex items-center gap-2 font-semibold">
              <Lightbulb className="h-4 w-4 text-gold" /> {t("social.brain.insightsTitle")}
            </p>
            {l && l.posts >= 3 ? (
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-elevated p-3">
                    <p className="text-2xl font-bold">{l.avg}</p>
                    <p className="text-[11.5px] text-muted">{t("social.brain.avgEng")}</p>
                  </div>
                  <div className="rounded-xl bg-elevated p-3">
                    <p className="text-2xl font-bold" dir="ltr">
                      {l.bestHours.length ? l.bestHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(" · ") : "—"}
                    </p>
                    <p className="text-[11.5px] text-muted">{t("social.brain.bestHours")}</p>
                  </div>
                </div>
                {pillarRows.length ? (
                  <div>
                    <p className="mb-2 text-[12.5px] font-medium text-muted">{t("social.brain.bestPillars")}</p>
                    <ul className="space-y-2">
                      {pillarRows.map(([k, v]) => (
                        <Bar key={k} label={k} value={v} max={maxP} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {mediaRows.length > 1 ? (
                  <div>
                    <p className="mb-2 text-[12.5px] font-medium text-muted">{t("social.brain.bestMedia")}</p>
                    <ul className="space-y-2">
                      {mediaRows.map(([k, v]) => (
                        <Bar key={k} label={t(`social.brain.kind_${k}`)} value={v} max={maxP} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                <ul className="space-y-1 text-[12.5px] text-muted">
                  {l.bestLength ? <li>• {t(`social.brain.len_${l.bestLength}`)}</li> : null}
                  {l.questionsWork !== null ? <li>• {t(l.questionsWork ? "social.brain.questionsYes" : "social.brain.questionsNo")}</li> : null}
                  {/* deeper patterns: the opening that works, best days, emojis, calls to action, hashtag count */}
                  {(() => {
                    const deep = (l as Learned & { deep?: DeepLearned }).deep;
                    if (!deep) return null;
                    const hooks = Object.entries(deep.hookScores ?? {}).sort((a, b) => b[1] - a[1]);
                    return (
                      <>
                        {hooks.length >= 2 ? <li>• {t("social.brain.deep.hook", { hook: t(`social.brain.deep.hooks.${hooks[0]![0]}`) })}</li> : null}
                        {deep.bestDays?.length ? <li>• {t("social.brain.deep.days", { days: deep.bestDays.map((d) => dayName(d)).join(" · ") })}</li> : null}
                        {deep.emojiWorks !== null && deep.emojiWorks !== undefined ? <li>• {t(deep.emojiWorks ? "social.brain.deep.emojiYes" : "social.brain.deep.emojiNo")}</li> : null}
                        {deep.ctaWorks !== null && deep.ctaWorks !== undefined ? <li>• {t(deep.ctaWorks ? "social.brain.deep.ctaYes" : "social.brain.deep.ctaNo")}</li> : null}
                        {deep.hashtagSweetSpot !== null && deep.hashtagSweetSpot !== undefined ? <li>• {t("social.brain.deep.tags", { n: deep.hashtagSweetSpot })}</li> : null}
                      </>
                    );
                  })()}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-muted">{t("social.brain.notEnough")}</p>
            )}
          </div>

          {holidays.length ? (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Flame className="h-4 w-4 text-danger" /> {t("social.brain.holidaysAhead")}
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {holidays.map((h) => (
                  <li key={h.date + h.key} className="flex items-center justify-between gap-2">
                    <span>{locale === "en" ? h.en : locale === "ar" ? h.ar : h.he}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] text-subtle">{t("social.brain.inDays", { n: h.inDays })}</span>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(`h${h.key}`, () => smartPostNowAction({ locale, topic: locale === "en" ? h.en : locale === "ar" ? h.ar : h.he }))} loading={busy === `h${h.key}`}>
                        <Sparkles className="h-3.5 w-3.5" /> {t("social.brain.makeFor")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {p.reviews.length ? (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Quote className="h-4 w-4 text-accent" /> {t("social.brain.reviewsTitle")}
              </p>
              <ul className="mt-2 space-y-2">
                {p.reviews.slice(0, 3).map((r) => (
                  <li key={r.id} className="rounded-xl bg-elevated p-2.5 text-[12.5px]">
                    <p className="line-clamp-2" dir="auto">
                      “{r.body}” — {r.author ?? t("social.someone")}
                    </p>
                    <Button size="sm" variant="ghost" className="mt-1" disabled={pending} loading={busy === `r${r.id}`} onClick={() => run(`r${r.id}`, () => smartPostNowAction({ locale, reviewId: r.id }))}>
                      <Sparkles className="h-3.5 w-3.5" /> {t("social.brain.reviewToPost")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {p.topPosts.length ? (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Flame className="h-4 w-4 text-gold" /> {t("social.brain.topTitle")}
              </p>
              <ul className="mt-2 space-y-2">
                {p.topPosts.slice(0, 3).map((x) => (
                  <li key={x.id} className="flex gap-2.5 rounded-xl bg-elevated p-2.5 text-[12.5px]">
                    {x.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2" dir="auto">
                        {x.body}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-subtle">{t("social.brain.score", { n: x.engagement })}</span>
                        <Button size="sm" variant="ghost" disabled={pending} loading={busy === `t${x.id}`} onClick={() => run(`t${x.id}`, () => recyclePostAction({ locale, id: x.id }))}>
                          <Repeat2 className="h-3.5 w-3.5" /> {t("social.brain.recycle")}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
