"use client";

import { useRef, useState } from "react";
import { Film, Globe, ImageUp, Link2, Loader2, MessageCircle, MessageSquareText, MousePointerClick, Trash2, Upload, Video } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { CTA_TYPES, ctaLabel, ctaUrl, isVideoUrl, uploadCheck, type CtaType } from "@/lib/social/post-core";
import { createMediaUploadAction, saveAssetAction } from "@/app/[locale]/(dashboard)/social/studio-actions";

/** Uploads a file to a signed storage URL with progress (XHR gives upload progress; fetch does not). */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) {
      xhr.setRequestHeader("apikey", anon);
      xhr.setRequestHeader("authorization", `Bearer ${anon}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.send(file);
  });
}

const NEEDS_PHONE = new Set<CtaType>(["whatsapp", "call"]);

/**
 * Wave 51 — everything the big social tools put in the composer, next to what already existed:
 * upload a photo / video from the device (drag & drop, progress), a link card, a call-to-action button
 * (message us, WhatsApp, call, book, shop…), the first comment, and a live preview of how the post will look.
 */
export function PostExtras(props: {
  body: string;
  image: string;
  setImage: (v: string) => void;
  videoUrl: string;
  setVideoUrl: (v: string) => void;
  linkUrl: string;
  setLinkUrl: (v: string) => void;
  ctaType: string;
  setCtaType: (v: string) => void;
  ctaValue: string;
  setCtaValue: (v: string) => void;
  firstComment: string;
  setFirstComment: (v: string) => void;
  fb: boolean;
  ig: boolean;
}) {
  const { t, locale } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const cta = (CTA_TYPES as readonly string[]).includes(props.ctaType) ? (props.ctaType as CtaType) : null;
  const linkOk = !props.linkUrl.trim() || /^https?:\/\/\S+$/i.test(props.linkUrl.trim());
  const ctaTarget = cta ? ctaUrl({ type: cta, value: props.ctaValue || props.linkUrl }, { platform: "facebook", pageId: "page" }) : null;
  const domain = (() => {
    try {
      return props.linkUrl ? new URL(props.linkUrl).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  })();
  const video = props.videoUrl.trim();
  const image = props.image.trim().startsWith("https://") ? props.image.trim() : "";

  const upload = async (file: File | null | undefined) => {
    if (!file) return;
    const chk = uploadCheck({ type: file.type, size: file.size });
    if (!chk.ok) return void toast.error(t(chk.error === "type" ? "social.post.uploadType" : "social.post.uploadSize"));
    setProgress(0);
    try {
      const r = await createMediaUploadAction({ locale, type: file.type, size: file.size });
      if (r.error || !r.data) throw new Error(r.error ?? "social.post.uploadFailed");
      await putWithProgress(r.data.signedUrl, file, setProgress);
      if (r.data.kind === "video") {
        props.setVideoUrl(r.data.publicUrl);
        toast.success(t("social.post.videoAdded"));
      } else {
        props.setImage(r.data.publicUrl);
        void saveAssetAction({ locale, url: r.data.publicUrl, title: file.name.slice(0, 120) });
        toast.success(t("social.studio.imageChosen"));
      }
    } catch (e) {
      const key = (e as Error).message;
      toast.error(t(key.startsWith("social.") || key.startsWith("errors.") || key.startsWith("ai.") ? key : "social.post.uploadFailed"));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-3" data-testid="post-extras">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden /> {t("social.post.title")}
      </p>

      {/* media from the device */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        className={cn("flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed p-3 transition", drag ? "border-accent bg-accent-soft/40" : "border-line")}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <ImageUp className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-[10rem] flex-1">
          <p className="text-[13px] font-medium">{t("social.post.uploadTitle")}</p>
          <p className="text-[11.5px] text-muted">{t("social.post.uploadHint")}</p>
          {progress !== null ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("social.post.uploading")}>
              <div className="h-full rounded-full bg-accent-solid transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm" className="sr-only" id="post-media-file" onChange={(e) => void upload(e.target.files?.[0])} />
        <label htmlFor="post-media-file" className={cn("inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent-solid px-3.5 py-2 text-[13px] font-semibold text-accent-fg transition hover:bg-accent-solid-hover", progress !== null && "pointer-events-none opacity-60")} data-testid="post-upload">
          {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
          {progress !== null ? `${progress}%` : t("social.post.uploadBtn")}
        </label>
      </div>

      {video ? (
        <div className="flex items-start gap-3 rounded-xl border border-line p-2">
          <video src={video} controls preload="metadata" className="max-h-48 w-auto max-w-[60%] rounded-lg bg-black" aria-label={t("social.post.video")} />
          <div className="min-w-0 flex-1 space-y-1 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-medium">
              <Film className="h-4 w-4 text-accent" aria-hidden /> {t("social.post.video")}
            </p>
            <p className="text-muted">{props.ig ? t("social.post.videoIg") : t("social.post.videoFb")}</p>
            <button type="button" onClick={() => props.setVideoUrl("")} className="inline-flex items-center gap-1 text-danger hover:underline">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("social.post.removeVideo")}
            </button>
          </div>
        </div>
      ) : null}

      {/* link */}
      <div className="space-y-1.5">
        <label htmlFor="post-link" className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <Link2 className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("social.post.link")}
        </label>
        <Input id="post-link" value={props.linkUrl} onChange={(e) => props.setLinkUrl(e.target.value)} placeholder="https://…" dir="ltr" className={cn("h-9", !linkOk && "border-danger")} aria-invalid={!linkOk} />
        <p className="text-[11.5px] text-muted">{!linkOk ? <span className="text-danger">{t("social.post.linkInvalid")}</span> : props.ig && !props.fb ? t("social.post.linkIg") : t("social.post.linkHint")}</p>
      </div>

      {/* call-to-action button */}
      <div className="space-y-1.5">
        <label htmlFor="post-cta" className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <MousePointerClick className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("social.post.cta")}
        </label>
        <div className="flex flex-wrap gap-2">
          <select id="post-cta" value={props.ctaType} onChange={(e) => props.setCtaType(e.target.value)} className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" data-testid="post-cta">
            <option value="">{t("social.post.ctaNone")}</option>
            {CTA_TYPES.map((c) => (
              <option key={c} value={c}>
                {ctaLabel(c, locale)}
              </option>
            ))}
          </select>
          {cta && cta !== "message" ? (
            <Input
              value={props.ctaValue}
              onChange={(e) => props.setCtaValue(e.target.value)}
              placeholder={NEEDS_PHONE.has(cta) ? t("social.post.ctaPhone") : props.linkUrl || t("social.post.ctaUrl")}
              dir="ltr"
              className="h-9 min-w-[12rem] flex-1"
              aria-label={NEEDS_PHONE.has(cta) ? t("social.post.ctaPhone") : t("social.post.ctaUrl")}
            />
          ) : null}
        </div>
        {cta ? <p className={cn("text-[11.5px]", ctaTarget || cta === "message" ? "text-muted" : "text-danger")}>{cta === "message" ? t("social.post.ctaMessageHint") : ctaTarget ? `${t("social.post.ctaGoesTo")} ${ctaTarget.replace(/^tel:/, "")}` : t("social.post.ctaNeedsValue")}</p> : null}
      </div>

      {/* first comment */}
      <div className="space-y-1.5">
        <label htmlFor="post-first-comment" className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <MessageSquareText className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("social.post.firstComment")}
        </label>
        <Textarea id="post-first-comment" rows={2} value={props.firstComment} onChange={(e) => props.setFirstComment(e.target.value)} placeholder={t("social.post.firstCommentHint")} dir="auto" />
      </div>

      {/* live preview */}
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-muted">{t("social.post.preview")}</p>
        <div className="max-w-sm overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" data-testid="post-preview">
          <div className="flex items-center gap-2 p-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-solid text-[12px] font-bold text-accent-fg">SC</span>
            <div className="text-[12px] leading-tight">
              <p className="font-semibold">{t("social.post.yourPage")}</p>
              <p className="text-muted">{props.ig && !props.fb ? "Instagram" : "Facebook"}</p>
            </div>
          </div>
          {props.body.trim() ? (
            <p className="line-clamp-5 whitespace-pre-wrap px-3 pb-2 text-[13px]" dir="auto">
              {props.body}
            </p>
          ) : null}
          {video ? (
            <div className="relative grid aspect-video place-items-center bg-black text-white">
              <Video className="h-8 w-8 opacity-80" aria-hidden />
            </div>
          ) : image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="max-h-64 w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : null}
          {props.linkUrl && linkOk && !video && !image ? (
            <div className="border-t border-line bg-elevated px-3 py-2">
              <p className="flex items-center gap-1 text-[11px] uppercase text-muted" dir="ltr">
                <Globe className="h-3 w-3" aria-hidden /> {domain}
              </p>
            </div>
          ) : null}
          {cta ? (
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span className="truncate text-[12px] text-muted" dir="ltr">
                {domain || (cta === "message" ? "Messenger" : "")}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-elevated px-3 py-1.5 text-[12.5px] font-semibold">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> {ctaLabel(cta, locale).replace(/^\S+\s/, "")}
              </span>
            </div>
          ) : null}
          {props.firstComment.trim() ? (
            <p className="border-t border-line px-3 py-2 text-[12px] text-muted" dir="auto">
              💬 {props.firstComment}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Small badges on a post card: video / link / button / first comment. */
export function PostMediaBadges({ p }: { p: { link_url?: string | null; video_url?: string | null; cta_type?: string | null; first_comment?: string | null; image_url?: string | null } }) {
  const { t, locale } = useI18n();
  const items = [
    p.video_url || isVideoUrl(p.image_url) ? { key: "video", label: t("social.post.video") } : null,
    p.link_url ? { key: "link", label: t("social.post.link") } : null,
    p.cta_type && (CTA_TYPES as readonly string[]).includes(p.cta_type) ? { key: "cta", label: ctaLabel(p.cta_type as CtaType, locale) } : null,
    p.first_comment ? { key: "comment", label: t("social.post.firstComment") } : null,
  ].filter(Boolean) as { key: string; label: string }[];
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i.key} tone="neutral" className="text-[11px]">
          {i.label}
        </Badge>
      ))}
    </div>
  );
}
