"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { listVideosAction, startVideoAction, videoConfigAction, videoStatusAction, type VideoJobView } from "@/app/[locale]/(dashboard)/social/video-actions";

/**
 * AI video for the post: a short clip made by a video model from what the post says (the video director turns the
 * post into a professional shot). Paid with credits — the price is shown before anything is spent, and a clip that
 * fails costs nothing. The clip keeps being made when the page is closed; finished clips stay in the list below.
 */
const ASPECTS = ["9:16", "1:1", "16:9"] as const;
const STYLES = ["auto", "cinematic", "lifestyle", "product", "luxury", "energetic", "calm", "3d"] as const;

export function AiVideoPanel({ body, ig, onVideo }: { body: string; ig: boolean; onVideo: (url: string) => void }) {
  const { t, locale } = useI18n();
  const [cfg, setCfg] = useState<{ configured: boolean; credits: number } | null>(null);
  const [request, setRequest] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ig ? "9:16" : "1:1");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("auto");
  const [seconds, setSeconds] = useState(8);
  const [jobs, setJobs] = useState<VideoJobView[]>([]);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void videoConfigAction({ locale }).then((r) => r.data && setCfg(r.data));
    void listVideosAction({ locale }).then((r) => r.data && setJobs(r.data.jobs));
  }, [locale]);

  // the post's text is the default description of the clip (the person can refine it)
  const text = (request.trim() || body.trim()).slice(0, 2000);

  const open = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const openIds = open.map((j) => j.id).join(",");
  const poll = useCallback(async () => {
    const ids = openIds ? openIds.split(",") : [];
    const next = (await Promise.all(ids.map((id) => videoStatusAction({ locale, id })))).map((r) => r.data?.job).filter((j): j is VideoJobView => Boolean(j));
    // the toast once per finished clip (outside the state updater, which React may run twice)
    for (const n of next) {
      if (n.status === "done") toast.success(t("social.video.ready"), { id: `vid-${n.id}` });
      if (n.status === "failed") toast.error(t(n.errorKey ?? "social.video.err.failed"), { id: `vid-${n.id}` });
    }
    setJobs((prev) => prev.map((j) => next.find((n) => n.id === j.id) ?? j));
  }, [openIds, locale, t]);

  // while a clip is being made, check it every 6 seconds (the social clock finishes it too if the page is closed)
  useEffect(() => {
    if (!openIds) return;
    timer.current = window.setTimeout(() => void poll(), 6000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [openIds, poll, jobs]);

  const start = async () => {
    if (text.length < 4) return void toast.error(t("social.video.needText"));
    setStarting(true);
    const r = await startVideoAction({ locale, request: text, aspect, seconds, style });
    setStarting(false);
    if (r.error || !r.data) return void toast.error(t(r.error ?? "social.video.err.failed"));
    setJobs((prev) => [r.data!.job, ...prev]);
    toast.success(r.data.job.status === "done" ? t("social.video.ready") : t("social.video.started"));
  };

  if (cfg && !cfg.configured) {
    return (
      <div className="rounded-xl border border-dashed border-line p-4 text-[13px] text-muted" data-testid="ai-video-off">
        <p className="font-semibold text-fg">{t("social.video.title")}</p>
        <p className="mt-1">{t("social.video.notConfigured")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-elevated p-3" data-testid="ai-video-panel">
      <div className="flex items-start gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white shadow-sm">
          <Film className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">{t("social.video.title")}</p>
          <p className="text-[12px] text-muted">{t("social.video.hint")}</p>
        </div>
        {cfg ? (
          <span className="ms-auto shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent" data-testid="ai-video-price">
            {t("social.video.price", { n: cfg.credits })}
          </span>
        ) : null}
      </div>
      <Textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)} placeholder={body.trim() ? t("social.video.fromPost") : t("social.video.placeholder")} dir="auto" maxLength={2000} />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[12px] text-muted">
          {t("social.video.aspect")}
          <Select value={aspect} onChange={(e) => setAspect(e.target.value as (typeof ASPECTS)[number])}>
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {t(`social.video.aspects.${a.replace(":", "x")}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[12px] text-muted">
          {t("social.video.style")}
          <Select value={style} onChange={(e) => setStyle(e.target.value as (typeof STYLES)[number])}>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(`social.video.styles.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[12px] text-muted">
          {t("social.video.length")}
          <Select value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))}>
            {[5, 8].map((s) => (
              <option key={s} value={s}>
                {t("social.video.seconds", { n: s })}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void start()} disabled={starting || text.length < 4} data-testid="ai-video-start">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {starting ? t("social.video.starting") : t("social.video.create")}
        </Button>
        <span className="text-[11.5px] text-muted">{t("social.video.refund")}</span>
      </div>
      {jobs.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="ai-video-jobs">
          {jobs.map((j) => (
            <li key={j.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className={cn("relative grid place-items-center bg-neutral-900/90", j.aspect === "9:16" ? "aspect-[9/12]" : j.aspect === "1:1" ? "aspect-square" : "aspect-video")}>
                {j.status === "done" && j.videoUrl ? (
                  <video src={j.videoUrl} className="h-full w-full object-cover" controls muted playsInline loop />
                ) : j.status === "failed" ? (
                  <p className="px-3 text-center text-[12px] text-red-300">{t(j.errorKey ?? "social.video.err.failed")}</p>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/80">
                    <Sparkles className="h-6 w-6 animate-pulse" />
                    <span className="text-[12px]">{t("social.video.making")}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 p-2">
                <p className="line-clamp-1 min-w-0 flex-1 text-[12px] text-muted" dir="auto">
                  {j.request}
                </p>
                {j.status === "done" && j.videoUrl ? (
                  <Button size="sm" onClick={() => (onVideo(j.videoUrl!), toast.success(t("social.video.attached")))} data-testid="ai-video-use">
                    {t("social.video.use")}
                  </Button>
                ) : j.status === "running" || j.status === "queued" ? (
                  <Button size="sm" variant="ghost" aria-label={t("social.video.check")} onClick={() => void poll()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
