"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Download, Lightbulb, MessageSquareWarning, Search, Sparkles, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { runAgentNowAction } from "@/app/[locale]/(dashboard)/agents/actions";
import { aiWritePostAction } from "@/app/[locale]/(dashboard)/social/actions";
import { POST_TEMPLATES, TEMPLATE_KEYS, charInfo, computeStats, dayKey, localInput, monthGrid, postsByDay, suggestedSlots, toCsv, type CommentLite, type PostLite, type ReviewLite } from "@/lib/social/insights";

/** Wave 36 — everything the big social tools have, added next to what already existed. */

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { key: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] transition", value === o.key ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-hover")}>
          {o.label}
          {o.count !== undefined ? <span className="text-[11px] opacity-70">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <label className="relative block w-full sm:w-64">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("social.pro.search")} className="h-9 ps-9" dir="auto" aria-label={t("social.pro.search")} />
    </label>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <Download className="h-3.5 w-3.5" /> {t("social.pro.exportCsv")}
    </Button>
  );
}

/* ------------------------------------------------------------------ overview */
function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
    </div>
  );
}

export function OverviewPanel({ posts, comments, reviews, canPost, onGo }: { posts: PostLite[]; comments: CommentLite[]; reviews: ReviewLite[]; canPost: boolean; onGo: (tab: "comments" | "posts" | "reviews") => void }) {
  const { t, locale } = useI18n();
  const stats = useMemo(() => computeStats(posts, comments, reviews), [posts, comments, reviews]);
  const [pending, start] = useTransition();
  const sentTotal = Object.values(stats.comments.sentiment).reduce((a, b) => a + b, 0);
  const SENT: Record<string, string> = { positive: "bg-success", lead: "bg-success", question: "bg-accent-solid", neutral: "bg-line", negative: "bg-danger", spam: "bg-warning" };
  const maxDist = Math.max(1, ...stats.reviews.dist);
  const kinds = [...new Set(stats.attention.map((a) => a.kind))];
  return (
    <div className="space-y-4" data-testid="social-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("social.pro.kpi.openComments")} value={stats.comments.open} tone={stats.comments.open ? "danger" : undefined} />
        <Kpi label={t("social.pro.kpi.responseRate")} value={stats.comments.responseRate === null ? "—" : `${stats.comments.responseRate}%`} />
        {canPost ? <Kpi label={t("social.pro.kpi.scheduled")} value={stats.posts.scheduled} /> : null}
        {canPost ? <Kpi label={t("social.pro.kpi.nextWeek")} value={stats.posts.nextWeek} /> : null}
        {canPost ? <Kpi label={t("social.pro.kpi.published")} value={stats.posts.published} tone="success" /> : null}
        {canPost ? <Kpi label={t("social.pro.kpi.failed")} value={stats.posts.failed} tone={stats.posts.failed ? "danger" : undefined} /> : null}
        <Kpi label={t("social.pro.kpi.avgRating")} value={stats.reviews.avg === null ? "—" : `${stats.reviews.avg.toLocaleString(locale === "en" ? "en-GB" : locale)} ★`} />
        <Kpi label={t("social.pro.kpi.unansweredReviews")} value={stats.reviews.unanswered} tone={stats.reviews.unanswered ? "danger" : undefined} />
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-warning" /> {t("social.pro.attentionTitle")}
        </h3>
        {kinds.length ? (
          <ul className="space-y-1.5">
            {kinds.map((k) => {
              const items = stats.attention.filter((a) => a.kind === k);
              return (
                <li key={k} className="flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2 text-sm">
                  <span>
                    <Badge tone={k === "draftWaiting" ? "warning" : "danger"}>{items.length}</Badge> <span className="ms-1">{t(`social.pro.attention.${k}`)}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => onGo(items[0]!.tab)}>
                    {t("social.pro.open")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("social.pro.allGood")}</p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("social.pro.sentimentTitle")}</h3>
          {sentTotal ? (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-elevated" role="img" aria-label={t("social.pro.sentimentTitle")}>
                {Object.entries(stats.comments.sentiment).map(([k, n]) => (
                  <div key={k} className={SENT[k] ?? "bg-line"} style={{ width: `${(n / sentTotal) * 100}%` }} title={`${k}: ${n}`} />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                {Object.entries(stats.comments.sentiment).map(([k, n]) => (
                  <li key={k} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", SENT[k] ?? "bg-line")} /> {k in { negative: 1, lead: 1, question: 1, positive: 1, spam: 1 } ? t(`social.pro.sentiment.${k}`) : k} · {n}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">{t("social.pro.noData")}</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("social.pro.ratingTitle")}</h3>
          {stats.reviews.total ? (
            <ul className="space-y-1.5">
              {[5, 4, 3, 2, 1].map((s) => (
                <li key={s} className="flex items-center gap-2 text-[12px]">
                  <span className="inline-flex w-8 items-center gap-0.5 tabular-nums">
                    {s}
                    <Star className="h-3 w-3 text-warning" />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
                    <span className="block h-full rounded-full bg-warning" style={{ width: `${(stats.reviews.dist[s - 1]! / maxDist) * 100}%` }} />
                  </span>
                  <span className="w-6 text-end tabular-nums text-muted">{stats.reviews.dist[s - 1]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t("social.pro.noData")}</p>
          )}
        </div>
      </div>
      {canPost ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft/30 p-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-accent" /> {t("social.pro.agentTitle")}
            </h3>
            <p className="mt-1 text-[13px] text-muted">{t("social.pro.agentHint")}</p>
          </div>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await runAgentNowAction({ locale, agent: "marketing" });
                if (r.error) toast.error(t(r.error));
                else {
                  toast.success(t("social.pro.agentRan"));
                  onGo("posts");
                }
              })
            }
          >
            <Wand2 className="h-4 w-4" /> {t("social.pro.agentRun")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ calendar */
const DOT: Record<string, string> = { draft: "bg-warning", scheduled: "bg-accent-solid", publishing: "bg-accent-solid", published: "bg-success", partial: "bg-success", failed: "bg-danger" };

export function CalendarPanel({ posts, canPost, onNew, onEdit }: { posts: (PostLite & { image_url?: string | null })[]; canPost: boolean; onNew: (datetimeLocal: string) => void; onEdit: (id: string) => void }) {
  const { t, locale } = useI18n();
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [sel, setSel] = useState<string>(dayKey(today));
  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const byDay = useMemo(() => postsByDay(posts.filter((p) => p.status !== "canceled")), [posts]);
  const title = cursor.toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { month: "long", year: "numeric" });
  const move = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const selected = byDay.get(sel) ?? [];
  const past = sel < dayKey(today);
  return (
    <div className="space-y-3" data-testid="social-calendar">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label={t("social.pro.calPrev")}>
            <ChevronRight className="h-4 w-4 ltr:rotate-180" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSel(dayKey(today)); }}>
            {t("social.pro.calToday")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label={t("social.pro.calNext")}>
            <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-elevated text-center text-[12px] text-muted">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="py-2">
              {t(`social.pro.wd.${i}`)}
            </div>
          ))}
        </div>
        {grid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((d) => {
              const list = byDay.get(d.key) ?? [];
              return (
                <button key={d.key} type="button" onClick={() => setSel(d.key)} aria-pressed={sel === d.key} className={cn("min-h-[3.75rem] border-b border-e border-line p-1.5 text-start align-top transition hover:bg-surface-hover sm:min-h-[5rem]", !d.inMonth && "opacity-40", sel === d.key && "bg-accent-soft/40")}>
                  <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] tabular-nums", d.key === dayKey(today) && "bg-accent-solid text-accent-fg")}>{d.day}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {list.slice(0, 4).map((p) => (
                      <span key={p.id} className={cn("h-2 w-2 rounded-full", DOT[p.status] ?? "bg-line")} title={p.body.slice(0, 60)} />
                    ))}
                    {list.length > 4 ? <span className="text-[10px] text-muted">+{list.length - 4}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
        {(["draft", "scheduled", "published", "failed"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", DOT[s])} /> {t(`social.pro.status.${s}`)}
          </span>
        ))}
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{new Date(`${sel}T12:00`).toLocaleDateString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "long", day: "numeric", month: "long" })}</p>
          {canPost && !past ? (
            <Button size="sm" onClick={() => onNew(localInput(sel, 10))} data-testid="calendar-add">
              <CalendarPlus className="h-4 w-4" /> {t("social.pro.calAdd")}
            </Button>
          ) : null}
        </div>
        {selected.length ? (
          <ul className="space-y-2">
            {selected.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onEdit(p.id)} className="flex w-full items-start gap-2 rounded-xl bg-elevated px-3 py-2 text-start text-sm hover:bg-surface-hover">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[p.status] ?? "bg-line")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-muted">
                      {new Date(p.scheduled_at).toLocaleTimeString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { hour: "2-digit", minute: "2-digit" })} · {p.platforms.map((x) => (x === "instagram" ? "Instagram" : "Facebook")).join(" · ")}
                    </span>
                    <span className="line-clamp-2" dir="auto">
                      {p.body}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("social.pro.calEmpty")}</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ composer helpers */
export function ComposerExtras({ body, setBody, fb, ig, image, setAt }: { body: string; setBody: (v: string) => void; fb: boolean; ig: boolean; image: string; setAt: (v: string) => void }) {
  const { t, locale } = useI18n();
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"friendly" | "professional" | "playful" | "premium">("friendly");
  const [pending, start] = useTransition();
  const lang = locale === "en" || locale === "ar" ? locale : "he";
  const slots = useMemo(() => suggestedSlots(), []);
  const nets = [...(fb ? (["facebook"] as const) : []), ...(ig ? (["instagram"] as const) : [])];
  const fmt = (d: Date) => d.toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const local = (d: Date) => localInput(dayKey(d), d.getHours(), d.getMinutes());
  const put = (text: string) => {
    if (body.trim() && !window.confirm(t("social.pro.composer.aiOverwrite"))) return;
    setBody(text);
  };
  return (
    <div className="space-y-3" data-testid="composer-extras">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <Lightbulb className="h-3.5 w-3.5" /> {t("social.pro.composer.templates")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_KEYS.map((k) => (
            <button key={k} type="button" onClick={() => put(POST_TEMPLATES[lang][k])} className="rounded-full border border-line px-3 py-1 text-[13px] text-muted transition hover:bg-surface-hover">
              {t(`social.pro.tpl.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <Wand2 className="h-3.5 w-3.5" /> {t("social.pro.composer.aiTitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("social.pro.composer.aiTopic")} className="h-9 min-w-[12rem] flex-1" dir="auto" aria-label={t("social.pro.composer.aiTopic")} />
          <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" aria-label="tone">
            {(["friendly", "professional", "playful", "premium"] as const).map((x) => (
              <option key={x} value={x}>
                {t(`social.pro.composer.tone.${x}`)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            loading={pending}
            disabled={topic.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await aiWritePostAction({ locale, topic, tone, platform: ig && !fb ? "instagram" : "facebook" });
                if (r.error) toast.error(t(r.error));
                else if (r.data?.text) {
                  put(r.data.text);
                  toast.success(t("social.pro.composer.aiDone"));
                }
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("social.pro.composer.aiWrite")}
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-muted">{t("social.pro.composer.slots")}</p>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((d) => (
            <button key={d.toISOString()} type="button" onClick={() => setAt(local(d))} className="rounded-full border border-line px-3 py-1 text-[13px] text-muted transition hover:bg-surface-hover">
              {fmt(d)}
            </button>
          ))}
        </div>
      </div>
      {nets.length ? (
        <div className="space-y-2">
          {nets.map((n) => {
            const c = charInfo(body, n);
            return (
              <div key={n} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                <span className="font-medium">{n === "instagram" ? "Instagram" : "Facebook"}</span>
                <span className={cn("tabular-nums", c.tooLong ? "text-danger" : "text-muted")}>
                  {c.len}/{c.limit}
                </span>
                {n === "instagram" ? <span className={cn("tabular-nums", c.tooManyTags ? "text-danger" : "text-muted")}>#{c.hashtags}/30</span> : null}
                {c.tooLong ? <span className="text-danger">{t("social.pro.composer.tooLong", { net: n === "instagram" ? "Instagram" : "Facebook" })}</span> : null}
                {c.tooManyTags ? <span className="text-danger">{t("social.pro.composer.tooManyTags")}</span> : null}
                {n === "instagram" && !image.trim() ? <span className="text-warning">{t("social.pro.composer.imageNeeded")}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <MessageSquareWarning className="h-3.5 w-3.5" /> {t("social.pro.composer.preview")}
        </p>
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-3 shadow-sm">
          {image.trim().startsWith("https://") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.trim()} alt="" className="mb-2 max-h-56 w-full rounded-xl object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : null}
          <p className="whitespace-pre-wrap text-sm" dir="auto">
            {body.trim() ? body : <span className="text-subtle">{t("social.pro.composer.previewEmpty")}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
