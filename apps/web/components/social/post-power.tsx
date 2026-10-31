"use client";

import { useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, Camera, Clapperboard, Copy, Hash, Heart, MessageCircle, MessagesSquare, Send, Share2, Smartphone, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { isVideoUrl } from "@/lib/social/post-core";
import { MotionStudio } from "@/components/social/motion-studio";
import { hashtagsAction, repurposeAction } from "@/app/[locale]/(dashboard)/social/brain-actions";

/**
 * Wave 61 — power tools inside the post editor: a live 3D phone preview (Instagram / Facebook look),
 * Motion Studio (designed video / designed image from the picture), versions for every network and
 * smart hashtags. Purely additive — the editor's own fields are untouched.
 */

function PhonePreview({ body, image, video, platform, brand }: { body: string; image: string; video: string; platform: "facebook" | "instagram"; brand: string }) {
  const { t } = useI18n();
  const [style, setStyle] = useState<CSSProperties>({ transform: "perspective(1200px) rotateY(-14deg) rotateX(6deg)" });
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setStyle({ transform: `perspective(1200px) rotateY(${(x * 24).toFixed(1)}deg) rotateX(${(-y * 14).toFixed(1)}deg)` });
  };
  const media = video || (isVideoUrl(image) ? image : "");
  const caption = body.trim() || t("social.power.emptyText");
  return (
    <div className="flex justify-center py-2" onPointerMove={move} onPointerLeave={() => setStyle({ transform: "perspective(1200px) rotateY(-14deg) rotateX(6deg)" })}>
      <div style={style} className="relative w-[270px] rounded-[2.4rem] border-[10px] border-[#111] bg-[#111] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out motion-reduce:transform-none" data-testid="phone-preview">
        <div className="absolute start-1/2 top-1.5 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black rtl:translate-x-1/2" />
        <div className="h-[520px] overflow-hidden rounded-[1.8rem] bg-white text-[#111]" dir="auto">
          <div className="flex items-center gap-2 border-b border-black/5 px-3 pb-2 pt-6">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
              <div className="h-full w-full rounded-full bg-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{brand || t("social.power.yourBusiness")}</p>
              <p className="text-[10px] text-black/50">{platform === "instagram" ? "Instagram" : t("social.power.sponsoredNo")}</p>
            </div>
          </div>
          {platform === "facebook" ? <p className="line-clamp-4 whitespace-pre-wrap px-3 py-2 text-[12px] leading-snug">{caption}</p> : null}
          <div className={cn("relative w-full overflow-hidden bg-neutral-100", platform === "instagram" ? "aspect-square" : "aspect-[1.25]")}>
            {media ? (
              <video src={media} className="h-full w-full object-cover" muted autoPlay loop playsInline />
            ) : image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-[11px] text-black/40">{t("social.power.noMedia")}</div>
            )}
          </div>
          <div className="flex items-center gap-3 px-3 py-2 text-black/80">
            {platform === "instagram" ? (
              <>
                <Heart className="h-5 w-5" /> <MessageCircle className="h-5 w-5" /> <Send className="h-5 w-5 rtl:-scale-x-100" />
                <Bookmark className="ms-auto h-5 w-5" />
              </>
            ) : (
              <>
                <Heart className="h-4 w-4" /> <span className="text-[11px]">{t("social.power.like")}</span>
                <MessageCircle className="h-4 w-4" /> <span className="text-[11px]">{t("social.power.comment")}</span>
                <Share2 className="h-4 w-4" /> <span className="text-[11px]">{t("social.power.share")}</span>
              </>
            )}
          </div>
          {platform === "instagram" ? (
            <p className="line-clamp-5 whitespace-pre-wrap px-3 text-[12px] leading-snug">
              <b>{brand || t("social.power.yourBusiness")}</b> {caption}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const VERSION_KEYS = ["instagram", "facebook", "story", "reel", "telegram", "whatsapp", "linkedin"] as const;

export function PostPower(props: { body: string; setBody: (v: string) => void; image: string; setImage: (v: string) => void; video: string; setVideo: (v: string) => void; fb: boolean; ig: boolean; brand?: string }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<null | "preview" | "motion" | "versions">(null);
  const [platform, setPlatform] = useState<"facebook" | "instagram">(props.ig && !props.fb ? "instagram" : props.ig ? "instagram" : "facebook");
  const [versions, setVersions] = useState<Record<string, string> | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = (k: "preview" | "motion" | "versions") => setOpen((x) => (x === k ? null : k));
  const makeVersions = () =>
    start(async () => {
      setBusy("v");
      const r = await repurposeAction({ locale, text: props.body });
      setBusy(null);
      if (r.error || !r.data) return void toast.error(t(r.error ?? "ai.failed"));
      setVersions(r.data.versions);
      setOpen("versions");
    });
  const addTags = () =>
    start(async () => {
      setBusy("h");
      const r = await hashtagsAction({ locale, text: props.body, platform: props.ig ? "instagram" : "facebook" });
      setBusy(null);
      if (r.error || !r.data) return void toast.error(t(r.error ?? "ai.failed"));
      const have = new Set((props.body.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((x) => x.toLowerCase()));
      const add = r.data.tags.filter((x) => !have.has(x.toLowerCase())).slice(0, props.ig ? 12 : 4);
      if (!add.length) return void toast.success(t("social.power.tagsHave"));
      props.setBody(`${props.body.trimEnd()}\n\n${add.join(" ")}`);
      toast.success(t("social.power.tagsAdded", { n: add.length }));
    });
  const tool = "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition";
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-3" data-testid="post-power">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-[12.5px] font-semibold text-muted">{t("social.power.title")}</span>
        <button type="button" onClick={() => toggle("preview")} aria-expanded={open === "preview"} className={cn(tool, open === "preview" ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-hover")}>
          <Smartphone className="h-4 w-4" /> {t("social.power.preview")}
        </button>
        <button type="button" onClick={() => toggle("motion")} aria-expanded={open === "motion"} className={cn(tool, open === "motion" ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-hover")} data-testid="open-motion">
          <Clapperboard className="h-4 w-4" /> {t("social.power.motion")}
        </button>
        <button type="button" onClick={makeVersions} disabled={pending || props.body.trim().length < 20} className={cn(tool, "border-line hover:bg-surface-hover disabled:opacity-50")}>
          <Wand2 className="h-4 w-4" /> {busy === "v" ? t("social.power.working") : t("social.power.versions")}
        </button>
        <button type="button" onClick={addTags} disabled={pending || props.body.trim().length < 10} className={cn(tool, "border-line hover:bg-surface-hover disabled:opacity-50")}>
          <Hash className="h-4 w-4" /> {busy === "h" ? t("social.power.working") : t("social.power.tags")}
        </button>
      </div>
      {open === "preview" ? (
        <div>
          <div className="flex justify-center gap-1.5">
            {(["instagram", "facebook"] as const).map((pl) => (
              <button key={pl} type="button" aria-pressed={platform === pl} onClick={() => setPlatform(pl)} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px]", platform === pl ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
                {pl === "instagram" ? <Camera className="h-3.5 w-3.5" /> : <MessagesSquare className="h-3.5 w-3.5" />} {pl === "instagram" ? "Instagram" : "Facebook"}
              </button>
            ))}
          </div>
          <PhonePreview body={props.body} image={props.image} video={props.video} platform={platform} brand={props.brand ?? ""} />
        </div>
      ) : null}
      {open === "motion" ? <MotionStudio image={props.image} body={props.body} brand={props.brand} ig={props.ig} onVideo={props.setVideo} onImage={props.setImage} /> : null}
      {open === "versions" && versions ? (
        <ul className="grid gap-2 md:grid-cols-2" data-testid="post-versions">
          {VERSION_KEYS.filter((k) => versions[k]).map((k) => (
            <li key={k} className="rounded-xl border border-line bg-elevated p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-accent">{t(`social.power.v_${k}`)}</span>
                <span className="flex gap-1">
                  {k === "instagram" || k === "facebook" ? (
                    <Button size="sm" variant="ghost" onClick={() => props.setBody(versions[k]!)}>
                      {t("social.power.use")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-label={t("social.power.copy")} onClick={() => void navigator.clipboard.writeText(versions[k]!).then(() => toast.success(t("social.power.copied")))}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
              <p className="line-clamp-6 whitespace-pre-wrap text-[12.5px]" dir="auto">
                {versions[k]}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
