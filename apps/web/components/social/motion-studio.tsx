"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Image as ImageIcon, Pause, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { MOTION_ASPECTS, MOTION_PALETTES, MOTION_TEMPLATES, baseMime, canvasSize, coverRect, easeInOutCubic, easeOutCubic, headlineFrom, isRtl, kenBurns, pickRecorderType, seg, timeline, wrapLines, type MotionAspect, type MotionTemplate } from "@/lib/social/motion-core";
import { createMediaUploadAction, saveAssetAction } from "@/app/[locale]/(dashboard)/social/studio-actions";

/**
 * Wave 61 — Motion Studio: turns the post's picture into a designed, moving video (Ken Burns, 3D tilt,
 * floating card, neon, reveal, split) with the headline and a call-to-action card — rendered on a canvas
 * and recorded in the browser (MP4 where supported, else WebM), then attached to the post. The same design
 * can be saved as a designed still image. Nothing leaves the device until "attach".
 */

type Palette = (typeof MOTION_PALETTES)[number];
interface Opts {
  template: MotionTemplate;
  palette: Palette;
  headline: string;
  sub: string;
  cta: string;
  brand: string;
  font: string;
  seed: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function gradientBg(ctx: CanvasRenderingContext2D, w: number, h: number, pal: Palette, p: number) {
  const ang = p * Math.PI * 0.6;
  const g = ctx.createLinearGradient(w / 2 - Math.cos(ang) * w, h / 2 - Math.sin(ang) * h, w / 2 + Math.cos(ang) * w, h / 2 + Math.sin(ang) * h);
  g.addColorStop(0, pal.a);
  g.addColorStop(1, pal.b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, zoom: number, panX: number, panY: number) {
  if (!img) return;
  const r = coverRect(img.naturalWidth, img.naturalHeight, w, h, zoom, panX, panY);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
}

/** A card rotated around its vertical axis (slice-based perspective — real 3D look on a 2D canvas). */
function draw3DCard(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, cx: number, cy: number, w: number, h: number, angle: number, pal: Palette) {
  const slices = 48;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const depth = 0.55;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = pal.a;
  ctx.fillRect(cx - (w * cos) / 2, cy - h / 2 + 10, w * cos, h - 20);
  ctx.restore();
  const r = img ? coverRect(img.naturalWidth, img.naturalHeight, w, h, 1.05, 0, 0) : null;
  for (let i = 0; i < slices; i++) {
    const u0 = i / slices - 0.5;
    const u1 = (i + 1) / slices - 0.5;
    const x0 = cx + u0 * w * cos;
    const x1 = cx + u1 * w * cos;
    const z = (u0 + u1) / 2 * sin;
    const scale = 1 / (1 + z * depth);
    const sh = h * scale;
    if (img && r) ctx.drawImage(img, r.sx + ((i / slices) * r.sw), r.sy, r.sw / slices + 0.6, r.sh, x0, cy - sh / 2, Math.max(1, x1 - x0 + 0.6), sh);
    else {
      ctx.fillStyle = i % 2 ? pal.a : pal.b;
      ctx.fillRect(x0, cy - sh / 2, Math.max(1, x1 - x0 + 0.6), sh);
    }
  }
  // glossy light sweep
  const gl = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  const s = 0.5 + Math.sin(angle * 2) * 0.35;
  gl.addColorStop(Math.max(0, s - 0.12), "rgba(255,255,255,0)");
  gl.addColorStop(s, "rgba(255,255,255,0.22)");
  gl.addColorStop(Math.min(1, s + 0.12), "rgba(255,255,255,0)");
  ctx.fillStyle = gl;
  ctx.fillRect(cx - (w * Math.abs(cos)) / 2, cy - h / 2, w * Math.abs(cos), h);
}

function textBlock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, o: Opts, color: string, maxLines = 3, weight = 800): number {
  if (!text) return 0;
  ctx.font = `${weight} ${size}px ${o.font}`;
  ctx.direction = isRtl(text) ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(text, maxW, (s) => ctx.measureText(s).width, maxLines);
  const lh = size * 1.18;
  const top = y - ((lines.length - 1) * lh) / 2;
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
  return lines.length * lh;
}

function ctaPill(ctx: CanvasRenderingContext2D, w: number, h: number, o: Opts, k: number, cx = w / 2) {
  if (!o.cta || k <= 0) return;
  const size = Math.round(Math.min(w, h) * 0.042);
  ctx.save();
  ctx.globalAlpha = Math.min(1, k);
  ctx.font = `800 ${size}px ${o.font}`;
  ctx.direction = isRtl(o.cta) ? "rtl" : "ltr";
  const tw = Math.min((cx === w / 2 ? w : cx * 2) * 0.8, ctx.measureText(o.cta).width + size * 2.4);
  const ph = size * 2.2;
  const y = h - ph - h * 0.07 + (1 - k) * 40;
  ctx.translate(cx, y + ph / 2);
  ctx.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 24;
  roundRect(ctx, -tw / 2, -ph / 2, tw, ph, ph / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = o.palette.a;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(o.cta, 0, 2, tw - size);
  ctx.restore();
  if (o.brand) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, k) * 0.9;
    ctx.font = `600 ${Math.round(size * 0.7)}px ${o.font}`;
    ctx.direction = isRtl(o.brand) ? "rtl" : "ltr";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(o.brand, cx, h - h * 0.03);
    ctx.restore();
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement | null, p: number, o: Opts) {
  const tl = timeline(p);
  // tall formats (Reels / Stories) get bigger type — they are watched full screen on a phone
  const short = Math.min(w, h) * (h > w * 1.4 ? 1.18 : 1);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  switch (o.template) {
    case "tilt3d": {
      gradientBg(ctx, w, h, o.palette, p);
      ctx.globalAlpha = 0.35;
      drawCover(ctx, img, 0, 0, w, h, 1.3, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, w, h);
      const angle = (-0.55 + 0.75 * easeInOutCubic(p)) * (o.seed % 2 ? -1 : 1);
      const cw = Math.min(w, h) * 0.62;
      draw3DCard(ctx, img, w / 2, h * 0.5, cw, cw * (h > w ? 1.25 : 0.78), angle, o.palette);
      ctx.globalAlpha = tl.headline;
      textBlock(ctx, o.headline, w / 2, h * 0.13 + (1 - tl.headline) * 30, w * 0.86, Math.round(short * 0.068), o, o.palette.text);
      ctx.globalAlpha = tl.sub;
      textBlock(ctx, o.sub, w / 2, h * 0.8, w * 0.8, Math.round(short * 0.04), o, o.palette.text, 2, 600);
      break;
    }
    case "float": {
      gradientBg(ctx, w, h, o.palette, p);
      for (let i = 0; i < 14; i++) {
        const t = (p * (0.3 + (i % 5) * 0.08) + i * 0.137) % 1;
        ctx.beginPath();
        ctx.arc(((i * 0.618) % 1) * w, h - t * h * 1.2, short * (0.01 + (i % 4) * 0.012), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.08 + (i % 3) * 0.05})`;
        ctx.fill();
      }
      const cw = Math.min(w, h) * 0.66;
      const ch = h > w ? cw * 1.2 : cw * 0.72;
      const bob = Math.sin(p * Math.PI * 2) * short * 0.015;
      ctx.save();
      ctx.translate(w / 2, h * 0.52 + bob);
      ctx.rotate(Math.sin(p * Math.PI * 2) * 0.03 - 0.02);
      ctx.scale(0.9 + 0.1 * easeOutCubic(seg(p, 0, 0.2)), 0.9 + 0.1 * easeOutCubic(seg(p, 0, 0.2)));
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 26;
      roundRect(ctx, -cw / 2, -ch / 2, cw, ch, short * 0.04);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      const kb = kenBurns(p, o.seed);
      drawCover(ctx, img, -cw / 2, -ch / 2, cw, ch, kb.zoom, kb.panX, kb.panY);
      ctx.restore();
      ctx.globalAlpha = tl.headline;
      textBlock(ctx, o.headline, w / 2, h * 0.12 + (1 - tl.headline) * 30, w * 0.86, Math.round(short * 0.064), o, o.palette.text);
      ctx.globalAlpha = tl.sub;
      textBlock(ctx, o.sub, w / 2, h * 0.86 - (o.cta ? short * 0.1 : 0), w * 0.8, Math.round(short * 0.038), o, o.palette.text, 2, 600);
      break;
    }
    case "neon": {
      ctx.fillStyle = "#07060f";
      ctx.fillRect(0, 0, w, h);
      // synthwave floor
      ctx.strokeStyle = o.palette.b;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      const horizon = h * 0.62;
      for (let i = 0; i < 14; i++) {
        const t = ((i / 14 + p * 0.8) % 1) ** 2;
        const y = horizon + t * (h - horizon);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -10; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * w * 0.02, horizon);
        ctx.lineTo(w / 2 + i * w * 0.16, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const r = Math.min(w, h) * 0.2 * (0.85 + 0.15 * easeOutCubic(seg(p, 0, 0.25)));
      ctx.save();
      ctx.shadowColor = o.palette.b;
      ctx.shadowBlur = 50;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.31, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = o.palette.b;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.31, r, 0, Math.PI * 2);
      ctx.clip();
      const kb = kenBurns(p, o.seed);
      drawCover(ctx, img, w / 2 - r, h * 0.31 - r, r * 2, r * 2, kb.zoom, kb.panX, kb.panY);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = o.palette.a;
      ctx.shadowBlur = 30 + 10 * Math.sin(p * Math.PI * 6);
      ctx.globalAlpha = tl.headline;
      textBlock(ctx, o.headline, w / 2, h * 0.6, w * 0.86, Math.round(short * 0.064), o, "#ffffff");
      ctx.restore();
      ctx.globalAlpha = tl.sub;
      textBlock(ctx, o.sub, w / 2, h * 0.715, w * 0.8, Math.round(short * 0.036), o, "#e4e4f7", 2, 600);
      break;
    }
    case "reveal": {
      const kb = kenBurns(p, o.seed);
      drawCover(ctx, img, 0, 0, w, h, kb.zoom, kb.panX, kb.panY);
      const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const open = easeInOutCubic(seg(p, 0.02, 0.22));
      ctx.fillStyle = o.palette.a;
      ctx.fillRect(0, 0, (w / 2) * (1 - open), h);
      ctx.fillStyle = o.palette.b;
      ctx.fillRect(w - (w / 2) * (1 - open), 0, (w / 2) * (1 - open), h);
      const chars = Math.ceil(o.headline.length * seg(p, 0.2, 0.5));
      ctx.globalAlpha = 1;
      textBlock(ctx, o.headline.slice(0, chars), w / 2, h * 0.66, w * 0.86, Math.round(short * 0.07), o, "#ffffff");
      ctx.globalAlpha = tl.sub;
      textBlock(ctx, o.sub, w / 2, h * 0.79, w * 0.8, Math.round(short * 0.038), o, "#ffffff", 2, 600);
      break;
    }
    case "split": {
      const vertical = h > w;
      const kb = kenBurns(p, o.seed);
      const slide = easeOutCubic(seg(p, 0, 0.25));
      if (vertical) {
        drawCover(ctx, img, 0, 0, w, h * 0.58, kb.zoom, kb.panX, kb.panY);
        ctx.save();
        ctx.translate(0, (1 - slide) * h * 0.42);
        gradientBg(ctx, w, h, o.palette, p);
        ctx.restore();
        drawCover(ctx, img, 0, 0, w, h * 0.58, kb.zoom, kb.panX, kb.panY);
        ctx.globalAlpha = tl.headline;
        textBlock(ctx, o.headline, w / 2, h * 0.7, w * 0.86, Math.round(short * 0.07), o, o.palette.text);
        ctx.globalAlpha = tl.sub;
        textBlock(ctx, o.sub, w / 2, h * 0.8, w * 0.8, Math.round(short * 0.04), o, o.palette.text, 2, 600);
      } else {
        gradientBg(ctx, w, h, o.palette, p);
        ctx.save();
        ctx.beginPath();
        ctx.rect(w * 0.5 - (1 - slide) * w * 0.5, 0, w * 0.5 + (1 - slide) * w * 0.5, h);
        ctx.clip();
        drawCover(ctx, img, w * 0.5, 0, w * 0.5, h, kb.zoom, kb.panX, kb.panY);
        ctx.restore();
        ctx.globalAlpha = tl.headline;
        textBlock(ctx, o.headline, w * 0.25, h * 0.42, w * 0.42, Math.round(short * 0.08), o, o.palette.text, 4);
        ctx.globalAlpha = tl.sub;
        textBlock(ctx, o.sub, w * 0.25, h * 0.66, w * 0.42, Math.round(short * 0.045), o, o.palette.text, 3, 600);
      }
      break;
    }
    default: {
      const kb = kenBurns(p, o.seed);
      if (img) drawCover(ctx, img, 0, 0, w, h, kb.zoom, kb.panX, kb.panY);
      else gradientBg(ctx, w, h, o.palette, p);
      const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `${o.palette.a}e6`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = tl.headline;
      textBlock(ctx, o.headline, w / 2, h * 0.64 + (1 - tl.headline) * 40, w * 0.86, Math.round(short * 0.072), o, "#ffffff");
      ctx.globalAlpha = tl.sub;
      textBlock(ctx, o.sub, w / 2, h * 0.76, w * 0.8, Math.round(short * 0.04), o, "#ffffff", 2, 600);
    }
  }
  ctx.globalAlpha = 1;
  ctaPill(ctx, w, h, o, tl.cta, o.template === "split" && w > h ? w * 0.25 : w / 2);
  if (tl.fadeOut > 0) {
    ctx.fillStyle = `rgba(0,0,0,${tl.fadeOut * 0.85})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function putBlob(url: string, blob: Blob, type: string, onProgress: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) {
      xhr.setRequestHeader("apikey", anon);
      xhr.setRequestHeader("authorization", `Bearer ${anon}`);
    }
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.send(blob);
  });
}

export function MotionStudio(props: { image: string; body: string; brand?: string; onVideo: (url: string) => void; onImage: (url: string) => void; ig: boolean }) {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [template, setTemplate] = useState<MotionTemplate>("tilt3d");
  const [aspect, setAspect] = useState<MotionAspect>(props.ig ? "9:16" : "1:1");
  const [palette, setPalette] = useState<Palette>(MOTION_PALETTES[0]!);
  const [headline, setHeadline] = useState(() => headlineFrom(props.body));
  const [sub, setSub] = useState("");
  const [cta, setCta] = useState(() => t("social.motion.ctaDefault"));
  const [seconds, setSeconds] = useState(8);
  const [playing, setPlaying] = useState(true);
  // which picture finished loading (and whether it failed) — set only from the image callbacks
  const [loaded, setLoaded] = useState<{ src: string; failed: boolean } | null>(null);
  const [rec, setRec] = useState<null | { phase: "rec" | "up"; pct: number }>(null);
  // a stable per-picture seed, so every picture moves a little differently
  const seed = [...props.image].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000, 7);
  const imgTainted = loaded?.src === props.image && loaded.failed;
  const imgReady = loaded?.src === props.image ? 1 : 0;
  const { w, h } = canvasSize(aspect);

  // load the picture (CORS-enabled so the canvas can be recorded)
  useEffect(() => {
    imgRef.current = null;
    if (!props.image) return;
    const src = props.image;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setLoaded({ src, failed: false });
    };
    img.onerror = () => setLoaded({ src, failed: true });
    img.src = src;
  }, [props.image]);

  const opts = useCallback(
    (): Opts => ({
      template,
      palette,
      headline: headline.trim(),
      sub: sub.trim(),
      cta: cta.trim(),
      brand: (props.brand ?? "").trim(),
      font: typeof window !== "undefined" ? getComputedStyle(document.body).fontFamily || "system-ui, sans-serif" : "system-ui, sans-serif",
      seed,
    }),
    [template, palette, headline, sub, cta, props.brand, seed],
  );

  // live preview loop
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0;
    const start = performance.now();
    const o = opts();
    const frame = (now: number) => {
      const p = playing ? (((now - start) / 1000) % seconds) / seconds : 0.82;
      drawFrame(ctx, w, h, imgRef.current, p, o);
      if (playing && !rec) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [opts, playing, seconds, w, h, imgReady, rec]);

  const upload = async (blob: Blob, type: string): Promise<string> => {
    setRec({ phase: "up", pct: 0 });
    const r = await createMediaUploadAction({ locale, type, size: blob.size });
    if (r.error || !r.data) throw new Error(r.error ?? "social.post.uploadFailed");
    await putBlob(r.data.signedUrl, blob, type, (pct) => setRec({ phase: "up", pct }));
    return r.data.publicUrl;
  };

  const record = async () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (typeof MediaRecorder === "undefined" || typeof c.captureStream !== "function") return void toast.error(t("social.motion.unsupported"));
    const mime = pickRecorderType((x) => MediaRecorder.isTypeSupported(x));
    if (!mime) return void toast.error(t("social.motion.unsupported"));
    try {
      const stream = c.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
      const o = opts();
      setRec({ phase: "rec", pct: 0 });
      recorder.start(250);
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          const p = Math.min(1, (now - start) / (seconds * 1000));
          drawFrame(ctx, w, h, imgRef.current, p, o);
          setRec({ phase: "rec", pct: Math.round(p * 100) });
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      recorder.stop();
      await done;
      stream.getTracks().forEach((tr) => tr.stop());
      const type = baseMime(mime);
      const blob = new Blob(chunks, { type });
      if (blob.size < 10_000) throw new Error("social.motion.failed");
      const url = await upload(blob, type);
      props.onVideo(url);
      toast.success(t(type === "video/mp4" || !props.ig ? "social.motion.videoAdded" : "social.motion.videoAddedWebm"));
    } catch (e) {
      const k = (e as Error).message;
      toast.error(t(k.startsWith("social.") ? k : imgTainted ? "social.motion.cors" : "social.motion.failed"));
    } finally {
      setRec(null);
    }
  };

  const saveStill = async () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    try {
      drawFrame(ctx, w, h, imgRef.current, 0.84, opts());
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("social.motion.failed");
      const url = await upload(blob, "image/jpeg");
      props.onImage(url);
      void saveAssetAction({ locale, url, title: headline.slice(0, 120) || "design" });
      toast.success(t("social.motion.imageAdded"));
    } catch (e) {
      const k = (e as Error).message;
      toast.error(t(k.startsWith("social.") ? k : imgTainted ? "social.motion.cors" : "social.motion.failed"));
    } finally {
      setRec(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="motion-studio">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-[12.5px] font-medium text-muted">{t("social.motion.template")}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {MOTION_TEMPLATES.map((k) => (
              <button key={k} type="button" aria-pressed={template === k} onClick={() => setTemplate(k)} className={cn("rounded-xl border px-2 py-2 text-[12.5px] transition", template === k ? "border-accent bg-accent-soft font-semibold text-accent shadow-sm" : "border-line text-muted hover:bg-surface-hover")}>
                {t(`social.motion.t_${k}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-[12.5px] font-medium text-muted">{t("social.motion.format")}</p>
            <div className="flex gap-1.5">
              {MOTION_ASPECTS.map((a) => (
                <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)} className={cn("rounded-lg border px-2.5 py-1 text-[12.5px]", aspect === a ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")} dir="ltr">
                  {a}
                </button>
              ))}
            </div>
          </div>
          <label className="space-y-1.5 text-[12.5px]">
            <span className="block font-medium text-muted">{t("social.motion.length")}</span>
            <Select className="h-9 w-24" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {[6, 8, 10, 15].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12.5px] font-medium text-muted">{t("social.motion.colors")}</p>
          <div className="flex flex-wrap gap-2">
            {MOTION_PALETTES.map((pl) => (
              <button key={pl.key} type="button" aria-label={pl.key} aria-pressed={palette.key === pl.key} onClick={() => setPalette(pl)} className={cn("h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition", palette.key === pl.key ? "ring-2 ring-accent" : "")} style={{ background: `linear-gradient(135deg, ${pl.a}, ${pl.b})` }} />
            ))}
          </div>
        </div>
        <label className="block space-y-1 text-[12.5px]">
          <span className="block font-medium text-muted">{t("social.motion.headline")}</span>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={90} dir="auto" />
        </label>
        <label className="block space-y-1 text-[12.5px]">
          <span className="block font-medium text-muted">{t("social.motion.sub")}</span>
          <Input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={120} dir="auto" placeholder={t("social.motion.subPh")} />
        </label>
        <label className="block space-y-1 text-[12.5px]">
          <span className="block font-medium text-muted">{t("social.motion.cta")}</span>
          <Input value={cta} onChange={(e) => setCta(e.target.value)} maxLength={40} dir="auto" />
        </label>
        {!props.image ? <p className="text-[12px] text-subtle">{t("social.motion.noImage")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void record()} loading={rec?.phase === "rec"} disabled={Boolean(rec)} data-testid="motion-record">
            <Clapperboard className="h-4 w-4" /> {t("social.motion.make")}
          </Button>
          <Button variant="secondary" onClick={() => void saveStill()} disabled={Boolean(rec)}>
            <ImageIcon className="h-4 w-4" /> {t("social.motion.still")}
          </Button>
        </div>
        {rec ? (
          <div className="space-y-1">
            <p className="text-[12px] text-muted">{t(rec.phase === "rec" ? "social.motion.recording" : "social.motion.uploading", { n: rec.pct })}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
              <div className="h-full bg-accent-solid transition-[width]" style={{ width: `${rec.pct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-[#0b0b12] p-2 shadow-inner">
          <canvas ref={canvasRef} width={w} height={h} className="mx-auto block max-h-[440px] w-auto max-w-full rounded-xl" aria-label={t("social.motion.preview")} />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-subtle">
          <Button size="sm" variant="ghost" onClick={() => setPlaying((x) => !x)} disabled={Boolean(rec)} aria-label={playing ? t("social.motion.pause") : t("social.motion.play")}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Sparkles className="h-3.5 w-3.5" /> {t("social.motion.hint")}
        </div>
      </div>
    </div>
  );
}
