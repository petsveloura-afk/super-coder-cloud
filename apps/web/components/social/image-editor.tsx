"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crop, ImageIcon, Loader2, RotateCcw, SlidersHorizontal, Type } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { DEFAULT_ADJUST, FRAMES, LOOKS, bandLayout, coverCrop, filterString, isRtlText, readableOn, wrapLines, type Adjust, type BandPos, type FrameKey } from "@/lib/social/image-edit-core";
import { createMediaUploadAction, saveAssetAction } from "@/app/[locale]/(dashboard)/social/studio-actions";

/**
 * Post editor — "Edit picture": the post's picture is framed for the network (square / 4:5 / landscape / story), with zoom
 * and focus, ready looks and fine adjustments (light, contrast, color, warmth, blur, vignette) and an optional headline
 * band in the brand color. Everything is drawn in the browser; the result is saved as a NEW picture in the business's media
 * (the original stays untouched) and set as the post's picture.
 */

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}

function draw(canvas: HTMLCanvasElement, img: HTMLImageElement, o: { frame: FrameKey; zoom: number; fx: number; fy: number; adjust: Adjust; headline: string; band: BandPos; color: string; scale: number }) {
  const f = FRAMES[o.frame];
  const W = Math.round(f.w * o.scale);
  const H = Math.round(f.h * o.scale);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const c = coverCrop({ w: img.naturalWidth, h: img.naturalHeight }, { w: W, h: H }, o.zoom, o.fx, o.fy);
  ctx.save();
  ctx.filter = filterString(o.adjust);
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  ctx.restore();
  if (o.adjust.vignette > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${(o.adjust.vignette / 100).toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const text = o.headline.trim();
  if (text) {
    const probe = bandLayout({ w: W, h: H }, 1, o.band);
    ctx.font = `700 ${probe.font}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    const lines = wrapLines(text, W - probe.pad * 4, (s) => ctx.measureText(s).width, 3);
    const L = bandLayout({ w: W, h: H }, lines.length, o.band);
    ctx.fillStyle = o.color;
    ctx.globalAlpha = 0.9;
    const radius = Math.round(L.font * 0.35);
    const x = L.pad;
    const w = W - L.pad * 2;
    ctx.beginPath();
    ctx.roundRect(x, L.y, w, L.h, radius);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = readableOn(o.color);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.direction = isRtlText(text) ? "rtl" : "ltr";
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, L.y + L.pad + i * L.lineH));
  }
}

export function ImageEditor({ image, setImage, ig, brandColor }: { image: string; setImage: (v: string) => void; ig: boolean; brandColor?: string | null }) {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // the loaded picture is kept with the address it came from — a new address simply does not match until it loaded
  const [loaded, setLoaded] = useState<{ src: string; img: HTMLImageElement | null; failed: boolean } | null>(null);
  const [frame, setFrame] = useState<FrameKey>(ig ? "portrait" : "landscape");
  const [zoom, setZoom] = useState(1);
  const [fx, setFx] = useState(0.5);
  const [fy, setFy] = useState(0.5);
  const [adjust, setAdjust] = useState<Adjust>(DEFAULT_ADJUST);
  const [look, setLook] = useState("natural");
  const [headline, setHeadline] = useState("");
  const [band, setBand] = useState<BandPos>("bottom");
  const [color, setColor] = useState(brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#111827");
  const [saving, setSaving] = useState(false);
  const src = image.trim();
  // https pictures (storage, generators); local http only while developing
  const allowed = /^https:\/\//.test(src) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(src);
  const img = loaded?.src === src ? loaded.img : null;
  const failed = Boolean(src) && (!allowed || (loaded?.src === src && loaded.failed));

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    loadImage(src)
      .then((i) => alive && setLoaded({ src, img: i, failed: false }))
      .catch(() => alive && setLoaded({ src, img: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [src, allowed]);

  const opts = useMemo(() => ({ frame, zoom, fx, fy, adjust, headline, band, color }), [frame, zoom, fx, fy, adjust, headline, band, color]);
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    // the preview is drawn at a third of the final size (fast on phones); the saved picture is full size
    draw(canvasRef.current, img, { ...opts, scale: 1 / 3 });
  }, [img, opts]);

  const reset = () => {
    setZoom(1);
    setFx(0.5);
    setFy(0.5);
    setAdjust(DEFAULT_ADJUST);
    setLook("natural");
    setHeadline("");
  };

  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const out = document.createElement("canvas");
      draw(out, img, { ...opts, scale: 1 });
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("social.imageEdit.failed");
      const r = await createMediaUploadAction({ locale, type: "image/jpeg", size: blob.size });
      if (r.error || !r.data) throw new Error(r.error ?? "social.post.uploadFailed");
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const res = await fetch(r.data.signedUrl, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg", "x-upsert": "false", "cache-control": "max-age=31536000", ...(anon ? { apikey: anon, authorization: `Bearer ${anon}` } : {}) } });
      if (!res.ok) throw new Error("social.post.uploadFailed");
      setImage(r.data.publicUrl);
      void saveAssetAction({ locale, url: r.data.publicUrl, title: t("social.imageEdit.assetTitle") });
      toast.success(t("social.imageEdit.saved"));
      reset();
    } catch (e) {
      const key = (e as Error).message;
      // a picture from another site that does not allow editing (the browser blocks reading it)
      toast.error(t(/insecure|tainted|security/i.test(key) ? "social.imageEdit.blocked" : key.startsWith("social.") || key.startsWith("errors.") || key.startsWith("ai.") ? key : "social.imageEdit.failed"));
    } finally {
      setSaving(false);
    }
  };

  if (!src) return <p className="rounded-xl border border-dashed border-line p-4 text-center text-[13px] text-muted">{t("social.imageEdit.noImage")}</p>;
  if (failed) return <p className="rounded-xl border border-dashed border-line p-4 text-center text-[13px] text-muted">{t("social.imageEdit.blocked")}</p>;

  const slider = (key: keyof Adjust, min: number, max: number, step = 1) => (
    <label className="grid gap-1 text-[12px]">
      <span className="flex justify-between text-muted">
        {t(`social.imageEdit.adj.${key}`)} <span className="tabular-nums">{adjust[key]}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={adjust[key]} onChange={(e) => (setAdjust((a) => ({ ...a, [key]: Number(e.target.value) })), setLook(""))} aria-label={t(`social.imageEdit.adj.${key}`)} />
    </label>
  );
  const pill = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50", on ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-hover");

  return (
    <div className="grid gap-4 rounded-xl border border-line bg-elevated p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="image-editor">
      <div className="flex items-center justify-center rounded-lg bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2">
        {img ? <canvas ref={canvasRef} className="max-h-[420px] w-auto max-w-full rounded-md shadow-lg" role="img" aria-label={t("social.imageEdit.preview")} /> : <Loader2 className="h-6 w-6 animate-spin text-muted" aria-label={t("social.imageEdit.loading")} />}
      </div>
      <div className="space-y-3">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <Crop className="h-3.5 w-3.5" /> {t("social.imageEdit.frame")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FRAMES) as FrameKey[]).map((k) => (
              <button key={k} type="button" aria-pressed={frame === k} className={pill(frame === k)} onClick={() => setFrame(k)}>
                {t(`social.imageEdit.frames.${k}`)}
              </button>
            ))}
          </div>
          <label className="grid gap-1 text-[12px]">
            <span className="flex justify-between text-muted">
              {t("social.imageEdit.zoom")} <span className="tabular-nums">{zoom.toFixed(1)}×</span>
            </span>
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={t("social.imageEdit.zoom")} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[12px] text-muted">
              {t("social.imageEdit.focusX")}
              <input type="range" min={0} max={1} step={0.01} value={fx} onChange={(e) => setFx(Number(e.target.value))} aria-label={t("social.imageEdit.focusX")} />
            </label>
            <label className="grid gap-1 text-[12px] text-muted">
              {t("social.imageEdit.focusY")}
              <input type="range" min={0} max={1} step={0.01} value={fy} onChange={(e) => setFy(Number(e.target.value))} aria-label={t("social.imageEdit.focusY")} />
            </label>
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t("social.imageEdit.look")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(LOOKS).map((k) => (
              <button key={k} type="button" aria-pressed={look === k} className={pill(look === k)} onClick={() => (setLook(k), setAdjust(LOOKS[k]!))}>
                {t(`social.imageEdit.looks.${k}`)}
              </button>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-[12px] text-muted">{t("social.imageEdit.fine")}</summary>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
              {slider("brightness", 50, 150)}
              {slider("contrast", 50, 150)}
              {slider("saturation", 0, 200)}
              {slider("warmth", -50, 50)}
              {slider("blur", 0, 6, 0.5)}
              {slider("vignette", 0, 80)}
            </div>
          </details>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
            <Type className="h-3.5 w-3.5" /> {t("social.imageEdit.headline")}
          </legend>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value.slice(0, 90))} placeholder={t("social.imageEdit.headlinePh")} dir="auto" aria-label={t("social.imageEdit.headline")} />
          {headline.trim() ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(["top", "center", "bottom"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={band === p} className={pill(band === p)} onClick={() => setBand(p)}>
                  {t(`social.imageEdit.band.${p}`)}
                </button>
              ))}
              <label className="ms-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
                {t("social.imageEdit.color")}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" aria-label={t("social.imageEdit.color")} />
              </label>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!img} data-testid="image-editor-save">
            <ImageIcon className="h-3.5 w-3.5" /> {t("social.imageEdit.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" /> {t("social.imageEdit.reset")}
          </Button>
          <p className="w-full text-[11.5px] text-subtle">{t("social.imageEdit.note", { w: FRAMES[frame].w, h: FRAMES[frame].h })}</p>
        </div>
      </div>
    </div>
  );
}
