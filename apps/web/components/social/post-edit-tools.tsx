"use client";

import { useMemo, useState } from "react";
import { Eraser, History, Languages, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { POST_EDITS, postStats, pushVersion, stripEmojis, stripHashtags, stripLinks, type PostEdit } from "@/lib/social/post-edits-core";
import { editPostAction } from "@/app/[locale]/(dashboard)/social/edit-actions";

/**
 * Post editor — "Edit text": quick AI edits that keep every fact (longer, warmer, professional, call to action, spelling,
 * emojis, platform fit, translate), free one-click clean-ups, live stats (characters left per network, what shows before
 * "see more", reading time) and a version history of this session (any version can be brought back).
 */
const AI_EDITS = POST_EDITS.filter((e) => !e.startsWith("translate_"));
const TRANSLATE = POST_EDITS.filter((e) => e.startsWith("translate_"));

export function PostEditTools({ body, setBody, fb, ig }: { body: string; setBody: (v: string) => void; fb: boolean; ig: boolean }) {
  const { t, locale } = useI18n();
  const platforms = useMemo(() => [...(fb ? (["facebook"] as const) : []), ...(ig ? (["instagram"] as const) : [])], [fb, ig]);
  const stats = useMemo(() => postStats(body, platforms.length ? [...platforms] : ["facebook"]), [body, platforms]);
  const [busy, setBusy] = useState<PostEdit | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const apply = (next: string) => {
    if (next.trim() === body.trim()) return void toast.success(t("social.edit.nothing"));
    setHistory((h) => pushVersion(h, body));
    setBody(next);
  };
  const ai = async (e: PostEdit) => {
    setBusy(e);
    const r = await editPostAction({ locale, text: body, edit: e, platform: ig && !fb ? "instagram" : ig ? "instagram" : "facebook" });
    setBusy(null);
    if (r.error || !r.data) return void toast.error(t(r.error ?? "ai.failed"));
    apply(r.data.text);
    toast.success(t("social.edit.done"));
  };
  const chip = "inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[12px] transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50";
  const disabled = Boolean(busy) || body.trim().length < 5;
  return (
    <div className="fade-slide space-y-3 rounded-xl border border-line bg-elevated p-3" data-testid="post-edit-tools">
      {/* live stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
        {stats.left.map((l) => (
          <div key={l.platform} className={cn("rounded-lg border px-2.5 py-1.5", l.left < 0 ? "border-danger/40 bg-danger/5" : "border-line bg-surface")}>
            <p className="text-[11px] text-muted">{l.platform === "instagram" ? "Instagram" : "Facebook"}</p>
            <p className={cn("text-[13px] font-semibold tabular-nums", l.left < 0 ? "text-danger" : "text-fg")}>{t(l.left < 0 ? "social.edit.over" : "social.edit.left", { n: Math.abs(l.left).toLocaleString() })}</p>
          </div>
        ))}
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <p className="text-[11px] text-muted">{t("social.edit.words")}</p>
          <p className="text-[13px] font-semibold tabular-nums">{stats.words}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <p className="text-[11px] text-muted">{t("social.edit.read")}</p>
          <p className="text-[13px] font-semibold tabular-nums">{t("social.edit.seconds", { n: stats.readSeconds })}</p>
        </div>
      </div>
      {stats.preview ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-3 py-2">
          <p className="mb-0.5 text-[11px] font-semibold text-muted">{t("social.edit.preview")}</p>
          <p className="text-[12.5px]" dir="auto">
            {stats.preview} {stats.cut ? <span className="text-subtle">{t("social.edit.seeMore")}</span> : null}
          </p>
        </div>
      ) : null}

      {/* AI edits */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 text-[12px] font-semibold text-muted">{t("social.edit.ai")}</span>
        {AI_EDITS.map((e) => (
          <button key={e} type="button" className={chip} disabled={disabled} onClick={() => void ai(e)} title={t(`social.edit.hint.${e}`)} data-testid={`post-edit-${e}`}>
            {busy === e ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {t(`social.edit.e.${e}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 inline-flex items-center gap-1 text-[12px] font-semibold text-muted">
          <Languages className="h-3.5 w-3.5" /> {t("social.edit.translate")}
        </span>
        {TRANSLATE.map((e) => (
          <button key={e} type="button" className={chip} disabled={disabled} onClick={() => void ai(e)}>
            {busy === e ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {t(`social.edit.e.${e}`)}
          </button>
        ))}
      </div>

      {/* free clean-ups */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-1 inline-flex items-center gap-1 text-[12px] font-semibold text-muted">
          <Eraser className="h-3.5 w-3.5" /> {t("social.edit.clean")}
        </span>
        <button type="button" className={chip} disabled={!stats.emojis} onClick={() => apply(stripEmojis(body))}>
          {t("social.edit.noEmojis", { n: stats.emojis })}
        </button>
        <button type="button" className={chip} disabled={!stats.hashtags} onClick={() => apply(stripHashtags(body))}>
          {t("social.edit.noHashtags", { n: stats.hashtags })}
        </button>
        <button type="button" className={chip} disabled={!stats.links} onClick={() => apply(stripLinks(body))}>
          {t("social.edit.noLinks", { n: stats.links })}
        </button>
      </div>

      {/* version history */}
      {history.length ? (
        <details className="rounded-lg border border-line bg-surface px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-muted">
            <History className="h-3.5 w-3.5" /> {t("social.edit.history", { n: history.length })}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((v, i) => (
              <li key={`${i}-${v.length}`} className="flex items-start gap-2">
                <p className="line-clamp-2 flex-1 text-[12px] text-muted" dir="auto">
                  {v}
                </p>
                <button type="button" className={chip} onClick={() => apply(v)}>
                  {t("social.edit.restore")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
