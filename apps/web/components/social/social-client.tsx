"use client";

import { classifyPublishError, publishHintKey } from "@/lib/social/errors";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarDays, Camera, CheckCircle2, Copy, EyeOff, LayoutDashboard, MessageSquareReply, MessagesSquare, Send, Settings2, Sparkles, Star, ThumbsUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { Chips, CalendarPanel, ComposerExtras, ExportButton, OverviewPanel, SearchBox, downloadCsv } from "@/components/social/social-extras";
import { StudioPanel } from "@/components/social/social-studio";
import { filterComments, filterPosts, filterReviews, type CommentFilter, type PostFilter, type ReviewFilter } from "@/lib/social/insights";
import { approveAllDraftsAction, commentStatusAction, duplicatePostAction, postStatusAction, replyCommentAction, replyReviewAction, reviewSettingsAction, savePostAction, saveSocialSettingsAction } from "@/app/[locale]/(dashboard)/social/actions";

/** Wave 19 — comments (with AI drafts), the content calendar, Google reviews, settings. */
export interface CommentRow {
  id: string;
  platform: "facebook" | "instagram";
  author_name: string | null;
  body: string;
  sentiment: string | null;
  ai_draft: string | null;
  reply_text: string | null;
  status: string;
  created_at: string;
}
export interface PostRow {
  id: string;
  platforms: ("facebook" | "instagram")[];
  body: string;
  image_url: string | null;
  scheduled_at: string;
  status: string;
  source: string;
  results: Record<string, { ok?: boolean; error?: string }>;
}
export interface ReviewRow {
  id: string;
  source: string;
  author: string | null;
  rating: number | null;
  body: string;
  reply: string | null;
  ai_draft: string | null;
  status: string;
  reviewed_at: string | null;
}
export interface SocialSettingsView {
  comment_drafts: boolean;
  comment_auto_reply: boolean;
  comment_private_reply: boolean;
  hide_spam: boolean;
  posts_per_week: number;
  brand_voice: string;
}

type Tab = "comments" | "posts" | "reviews" | "settings" | "calendar" | "insights";

function when(locale: string, iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { dateStyle: "short", timeStyle: "short", timeZone: DEFAULT_TIME_ZONE });
}

const SENT_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = { lead: "success", question: "accent", negative: "danger", spam: "warning", positive: "success", neutral: "neutral" };

function CommentCard({ c, canReply }: { c: CommentRow; canReply: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState(c.ai_draft ?? "");
  const [pending, start] = useTransition();
  const done = ["replied", "auto_replied", "hidden", "ignored"].includes(c.status);
  const act = (fn: () => Promise<{ error?: string; message?: string; messageParams?: Record<string, string | number> }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(t(r.error, r.messageParams));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  return (
    <li className={cn("rounded-2xl border border-line bg-surface p-4", done && "opacity-70")} data-comment={c.status}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1 font-semibold">
          {c.platform === "instagram" ? <Camera className="h-3.5 w-3.5" /> : <MessagesSquare className="h-3.5 w-3.5" />} {c.author_name ?? t("social.someone")}
        </span>
        {c.sentiment ? <Badge tone={SENT_TONE[c.sentiment] ?? "neutral"}>{t(`social.intent.${c.sentiment}`)}</Badge> : null}
        <Badge tone="neutral">{t(`social.status.${c.status}`)}</Badge>
        <span className="ms-auto text-subtle">{when(locale, c.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
        {c.body || "—"}
      </p>
      {c.reply_text ? (
        <p className="mt-2 rounded-xl bg-elevated px-3 py-2 text-[13px]" dir="auto">
          <MessageSquareReply className="me-1 inline h-3.5 w-3.5" /> {c.reply_text}
        </p>
      ) : null}
      {!done && canReply ? (
        <div className="mt-3 space-y-2">
          {c.ai_draft ? (
            <p className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gold">
              <Sparkles className="h-3.5 w-3.5" /> {t("social.aiDraft")}
            </p>
          ) : null}
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("social.replyPlaceholder")} dir="auto" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={pending} disabled={!text.trim()} onClick={() => act(() => replyCommentAction({ locale, id: c.id, text }))} data-testid="comment-reply">
              <Send className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t("social.publishReply")}
            </Button>
            {c.status !== "dm_sent" ? (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => commentStatusAction({ locale, id: c.id, action: "dm" }))}>
                {t("social.sendDm")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => commentStatusAction({ locale, id: c.id, action: "hide" }))}>
              <EyeOff className="h-3.5 w-3.5" /> {t("social.hide")}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => commentStatusAction({ locale, id: c.id, action: "ignore" }))}>
              {t("social.ignore")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function PostEditor({ initial, onDone, presetAt }: { initial?: PostRow | null; onDone: () => void; presetAt?: string | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState(initial?.body ?? "");
  const [image, setImage] = useState(initial?.image_url ?? "");
  const [fb, setFb] = useState(initial ? initial.platforms.includes("facebook") : true);
  const [ig, setIg] = useState(initial ? initial.platforms.includes("instagram") : false);
  const local = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [at, setAt] = useState(() => (!initial && presetAt ? presetAt : local(initial?.scheduled_at ?? new Date(Date.now() + 3_600_000).toISOString())));
  const [pending, start] = useTransition();
  const save = (draft: boolean) =>
    start(async () => {
      const platforms = [...(fb ? ["facebook"] : []), ...(ig ? ["instagram"] : [])];
      const r = await savePostAction({ locale, id: initial?.id ?? null, body, platforms, scheduled_at: new Date(at).toISOString(), image_url: image, draft });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        onDone();
        router.refresh();
      }
    });
  return (
    <div className="space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/30 p-4" data-testid="post-editor">
      <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("social.postPlaceholder")} dir="auto" aria-label={t("social.postText")} />
      <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/image.jpg" dir="ltr" aria-label={t("social.imageUrl")} />
      <ComposerExtras body={body} setBody={setBody} fb={fb} ig={ig} image={image} setAt={setAt} />
      <StudioPanel body={body} setBody={setBody} image={image} setImage={setImage} fb={fb} ig={ig} />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} /> Facebook
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={ig} onChange={(e) => setIg(e.target.checked)} /> Instagram
        </label>
        <label className="inline-flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-9 w-auto" aria-label={t("social.when")} />
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" loading={pending} disabled={!body.trim() || (!fb && !ig)} onClick={() => save(true)}>
          {t("social.saveDraft")}
        </Button>
        <Button loading={pending} disabled={!body.trim() || (!fb && !ig)} onClick={() => save(false)} data-testid="post-schedule">
          {t("social.schedule")}
        </Button>
      </div>
    </div>
  );
}

function PostCard({ p, onEdit }: { p: PostRow; onEdit: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (action: "approve" | "cancel" | "now") =>
    start(async () => {
      const r = await postStatusAction({ locale, id: p.id, action });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  const editable = ["draft", "scheduled", "failed"].includes(p.status);
  const duplicate = () =>
    start(async () => {
      const r = await duplicatePostAction({ locale, id: p.id });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" data-post={p.status}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge tone={p.status === "published" ? "success" : p.status === "failed" ? "danger" : p.status === "draft" ? "warning" : "accent"}>{t(`social.postStatus.${p.status}`)}</Badge>
        {p.source === "agent" ? (
          <Badge tone="neutral">
            <Sparkles className="me-1 inline h-3 w-3" /> {t("social.byAgent")}
          </Badge>
        ) : null}
        <span className="text-muted">{p.platforms.map((x) => (x === "instagram" ? "Instagram" : "Facebook")).join(" · ")}</span>
        <span className="ms-auto text-subtle">{when(locale, p.scheduled_at)}</span>
      </div>
      <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-sm" dir="auto">
        {p.body}
      </p>
      {Object.values(p.results ?? {}).some((r) => r && r.ok === false) ? (
        <div className="mt-2 space-y-1 text-[12px]">
          <p className="text-danger">{Object.entries(p.results).filter(([, r]) => r && r.ok === false).map(([k, r]) => `${k}: ${r.error ?? ""}`).join(" · ")}</p>
          {[...new Set(Object.values(p.results).filter((r) => r && r.ok === false).map((r) => publishHintKey(classifyPublishError(r.error))))]
            .filter((k): k is string => Boolean(k))
            .map((k) => (
              <p key={k} className="text-muted" data-testid="post-hint">
                {t(k)}{" "}
                {k === "social.errPermission" || k === "social.errToken" || k === "social.notConnected" ? (
                  <a href={`/${locale}/integrations#marketplace`} className="font-semibold text-accent hover:underline">
                    {t("social.reconnect")}
                  </a>
                ) : null}
              </p>
            ))}
        </div>
      ) : null}
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.status === "draft" ? (
            <Button size="sm" loading={pending} onClick={() => act("approve")} data-testid="post-approve">
              <ThumbsUp className="h-3.5 w-3.5" /> {t("social.approve")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("now")}>
            <Send className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t("social.publishNow")}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onEdit}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={duplicate}>
            <Copy className="h-3.5 w-3.5" /> {t("social.pro.duplicate")}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("cancel")}>
            <Trash2 className="h-3.5 w-3.5" /> {t("social.cancelPost")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={duplicate}>
            <Copy className="h-3.5 w-3.5" /> {t("social.pro.duplicate")}
          </Button>
        </div>
      )}
    </li>
  );
}

function Stars({ n }: { n: number | null }) {
  return (
    <span className="inline-flex" aria-label={`${n ?? 0}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", (n ?? 0) >= i ? "fill-amber-400 text-amber-400" : "text-line")} />
      ))}
    </span>
  );
}

function ReviewCard({ r, canReply }: { r: ReviewRow; canReply: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState(r.ai_draft ?? "");
  const [pending, start] = useTransition();
  const done = Boolean(r.reply);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" data-review={r.status}>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Stars n={r.rating} />
        <span className="font-semibold">{r.author ?? t("social.someone")}</span>
        <Badge tone={done ? "success" : "warning"}>{t(`social.reviewStatus.${r.status}`)}</Badge>
        <span className="ms-auto text-subtle">{when(locale, r.reviewed_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
        {r.body || "—"}
      </p>
      {done ? (
        <p className="mt-2 rounded-xl bg-elevated px-3 py-2 text-[13px]" dir="auto">
          <CheckCircle2 className="me-1 inline h-3.5 w-3.5 text-success" /> {r.reply}
        </p>
      ) : canReply ? (
        <div className="mt-3 space-y-2">
          {r.ai_draft ? (
            <p className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-gold">
              <Sparkles className="h-3.5 w-3.5" /> {t("social.aiDraft")}
            </p>
          ) : null}
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("social.replyPlaceholder")} dir="auto" />
          <Button
            size="sm"
            loading={pending}
            disabled={!text.trim()}
            onClick={() =>
              start(async () => {
                const x = await replyReviewAction({ locale, id: r.id, text });
                if (x.error) toast.error(t(x.error, x.messageParams));
                else {
                  toast.success(t(x.message ?? "common.saved"));
                  router.refresh();
                }
              })
            }
          >
            <Send className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t("social.publishReply")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function SettingsPanel({ s, google }: { s: SocialSettingsView; google: { connected: boolean; autoReplyPositive: boolean } }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(s);
  const [autoReviews, setAutoReviews] = useState(google.autoReplyPositive);
  const [pending, start] = useTransition();
  const toggle = (k: keyof SocialSettingsView) => (
    <label key={k} className="flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2.5 text-sm">
      <span>{t(`social.settings.${k}`)}</span>
      <input type="checkbox" checked={Boolean(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />
    </label>
  );
  return (
    <div className="max-w-2xl space-y-3" data-testid="social-settings">
      {toggle("comment_drafts")}
      {toggle("comment_auto_reply")}
      {toggle("comment_private_reply")}
      {toggle("hide_spam")}
      <label className="flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2.5 text-sm">
        <span>{t("social.settings.posts_per_week")}</span>
        <Input type="number" min={1} max={14} className="h-9 w-20 text-center" value={v.posts_per_week} onChange={(e) => setV({ ...v, posts_per_week: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })} />
      </label>
      <div className="space-y-1">
        <span className="text-sm">{t("social.settings.brand_voice")}</span>
        <Textarea rows={3} value={v.brand_voice} onChange={(e) => setV({ ...v, brand_voice: e.target.value })} placeholder={t("social.settings.brandVoiceHint")} dir="auto" />
      </div>
      {google.connected ? (
        <label className="flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2.5 text-sm">
          <span>{t("social.settings.autoReviews")}</span>
          <input type="checkbox" checked={autoReviews} onChange={(e) => setAutoReviews(e.target.checked)} />
        </label>
      ) : null}
      <div className="flex justify-end">
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveSocialSettingsAction({ locale, ...v });
              if (google.connected) await reviewSettingsAction({ locale, autoReplyPositive: autoReviews });
              if (r.error) toast.error(t(r.error));
              else {
                toast.success(t("common.saved"));
                router.refresh();
              }
            })
          }
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function SocialClient(p: { comments: CommentRow[]; posts: PostRow[]; reviews: ReviewRow[]; settings: SocialSettingsView; facebook: string | null; instagram: string | null; google: { connected: boolean; autoReplyPositive: boolean }; canReply: boolean; canPost: boolean; canSettings: boolean }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("comments");
  const [editing, setEditing] = useState<PostRow | null | "new">(null);
  const [presetAt, setPresetAt] = useState<string | null>(null);
  const [pf, setPf] = useState<PostFilter>({ status: "all", platform: "all", q: "" });
  const [cf, setCf] = useState<CommentFilter>({ status: "all", sentiment: "all", platform: "all", q: "" });
  const [rf, setRf] = useState<ReviewFilter>({ stars: "all", unanswered: false, q: "" });
  const [bulk, startBulk] = useTransition();
  const router = useRouter();
  const shownPosts = filterPosts(p.posts, pf);
  const shownComments = filterComments(p.comments, cf);
  const shownReviews = filterReviews(p.reviews, rf);
  const open = p.comments.filter((c) => c.status === "new" || c.status === "dm_sent").length;
  const tabs: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: "comments", label: t("social.tabs.comments"), count: open, show: true },
    { key: "posts", label: t("social.tabs.posts"), show: p.canPost },
    { key: "calendar", label: t("social.tabs.calendar"), show: p.canPost },
    { key: "reviews", label: t("social.tabs.reviews"), count: p.reviews.filter((r) => !r.reply).length, show: true },
    { key: "insights", label: t("social.tabs.insights"), show: true },
    { key: "settings", label: t("social.tabs.settings"), show: p.canSettings },
  ];
  const notConnected = !p.facebook && !p.instagram;
  return (
    <section data-testid="social-page">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={p.facebook ? "success" : "neutral"}>
          <MessagesSquare className="me-1 inline h-3.5 w-3.5" /> {p.facebook ?? t("social.fbNotConnected")}
        </Badge>
        <Badge tone={p.instagram ? "success" : "neutral"}>
          <Camera className="me-1 inline h-3.5 w-3.5" /> {p.instagram ?? t("social.igNotConnected")}
        </Badge>
        <Badge tone={p.google.connected ? "success" : "neutral"}>
          <Star className="me-1 inline h-3.5 w-3.5" /> {t(p.google.connected ? "social.googleOn" : "social.googleOff")}
        </Badge>
        {notConnected ? (
          <a href={`/${locale}/integrations#marketplace`} className="font-semibold text-accent hover:underline">
            {t("social.connectNow")}
          </a>
        ) : null}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1" role="tablist">
        {tabs
          .filter((x) => x.show)
          .map((x) => (
            <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)} className={cn("inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition", tab === x.key ? "bg-accent-solid text-accent-fg shadow-sm" : "text-muted hover:bg-surface-hover")} data-tab={x.key}>
              {x.key === "settings" ? <Settings2 className="h-4 w-4" /> : x.key === "calendar" ? <CalendarDays className="h-4 w-4" /> : x.key === "insights" ? <LayoutDashboard className="h-4 w-4" /> : null}
              {x.label}
              {x.count ? <span className="rounded-full bg-danger px-1.5 text-[11px] text-white">{x.count}</span> : null}
            </button>
          ))}
      </div>
      {tab === "comments" ? (
        p.comments.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Chips label={t("social.pro.filters")} value={cf.status} onChange={(v) => setCf({ ...cf, status: v })} options={[{ key: "all", label: t("social.pro.all"), count: p.comments.length }, { key: "open", label: t("social.pro.open"), count: open }, { key: "done", label: t("social.pro.done") }]} />
              <div className="flex flex-wrap items-center gap-2">
                <SearchBox value={cf.q} onChange={(q) => setCf({ ...cf, q })} />
                <ExportButton onClick={() => downloadCsv("comments.csv", [["date", "platform", "author", "sentiment", "status", "text"], ...shownComments.map((c) => [c.created_at, c.platform, c.author_name, c.sentiment, c.status, c.body])])} />
              </div>
            </div>
            <Chips label={t("social.pro.filters")} value={cf.sentiment} onChange={(v) => setCf({ ...cf, sentiment: v })} options={[{ key: "all", label: t("social.pro.all") }, ...(["negative", "lead", "question", "positive", "spam"] as const).map((k) => ({ key: k, label: t(`social.pro.sentiment.${k}`) }))]} />
            {shownComments.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {shownComments.map((c) => (
                  <CommentCard key={c.id} c={c} canReply={p.canReply} />
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("social.noComments")}</p>
            )}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("social.noComments")}</p>
        )
      ) : null}
      {tab === "posts" ? (
        <div className="space-y-3">
          {editing ? (
            <PostEditor initial={editing === "new" ? null : editing} presetAt={presetAt} onDone={() => { setEditing(null); setPresetAt(null); }} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setEditing("new")} data-testid="post-new">
                <Sparkles className="h-4 w-4" /> {t("social.newPost")}
              </Button>
              {p.posts.some((x) => x.status === "draft") ? (
                <Button
                  variant="secondary"
                  loading={bulk}
                  onClick={() =>
                    startBulk(async () => {
                      const r = await approveAllDraftsAction({ locale });
                      if (r.error) toast.error(t(r.error));
                      else {
                        toast.success(t(r.message ?? "common.saved", r.messageParams));
                        router.refresh();
                      }
                    })
                  }
                >
                  <ThumbsUp className="h-4 w-4" /> {t("social.pro.approveAll")}
                </Button>
              ) : null}
              <ExportButton onClick={() => downloadCsv("posts.csv", [["scheduled_at", "status", "platforms", "text"], ...shownPosts.map((x) => [x.scheduled_at, x.status, x.platforms.join("+"), x.body])])} />
            </div>
          )}
          {p.posts.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chips label={t("social.pro.filters")} value={pf.status} onChange={(v) => setPf({ ...pf, status: v })} options={[{ key: "all", label: t("social.pro.all"), count: p.posts.length }, ...(["draft", "scheduled", "published", "failed"] as const).map((k) => ({ key: k, label: t(`social.pro.status.${k}`), count: filterPosts(p.posts, { ...pf, status: k, platform: "all", q: "" }).length }))]} />
                <SearchBox value={pf.q} onChange={(q) => setPf({ ...pf, q })} />
              </div>
              <Chips label="platform" value={pf.platform} onChange={(v) => setPf({ ...pf, platform: v })} options={[{ key: "all", label: t("social.pro.all") }, { key: "facebook", label: "Facebook" }, { key: "instagram", label: "Instagram" }]} />
              {shownPosts.length ? (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {shownPosts.map((x) => (
                    <PostCard key={x.id} p={x} onEdit={() => setEditing(x)} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("social.noPosts")}</p>
              )}
            </>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("social.noPosts")}</p>
          )}
        </div>
      ) : null}
      {tab === "calendar" ? (
        <CalendarPanel
          posts={p.posts}
          canPost={p.canPost}
          onNew={(at) => {
            setPresetAt(at);
            setEditing("new");
            setTab("posts");
          }}
          onEdit={(id) => {
            const x = p.posts.find((r) => r.id === id);
            if (x && ["draft", "scheduled", "failed"].includes(x.status)) setEditing(x);
            setTab("posts");
          }}
        />
      ) : null}
      {tab === "insights" ? <OverviewPanel posts={p.posts} comments={p.comments} reviews={p.reviews} canPost={p.canPost} onGo={(x) => setTab(x)} /> : null}
      {tab === "reviews" ? (
        p.reviews.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Chips label={t("social.pro.filters")} value={rf.stars} onChange={(v) => setRf({ ...rf, stars: v })} options={[{ key: "all", label: t("social.pro.anyStars") }, ...(["5", "4", "3", "2", "1"] as const).map((k) => ({ key: k, label: `${k} ★` }))]} />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={rf.unanswered} onChange={(e) => setRf({ ...rf, unanswered: e.target.checked })} /> {t("social.pro.unanswered")}
                </label>
                <SearchBox value={rf.q} onChange={(q) => setRf({ ...rf, q })} />
                <ExportButton onClick={() => downloadCsv("reviews.csv", [["date", "author", "rating", "replied", "text"], ...shownReviews.map((r) => [r.reviewed_at, r.author, r.rating, r.reply ? "yes" : "no", r.body])])} />
              </div>
            </div>
            <ul className="grid gap-3 lg:grid-cols-2">
              {shownReviews.map((r) => (
                <ReviewCard key={r.id} r={r} canReply={p.canReply} />
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t(p.google.connected ? "social.noReviews" : "social.reviewsConnect")}</p>
        )
      ) : null}
      {tab === "settings" ? <SettingsPanel s={p.settings} google={p.google} /> : null}
    </section>
  );
}
