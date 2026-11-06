"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Check, Clock, Gift, Heart, Loader2, Megaphone, Rocket, ShieldCheck, Smartphone, Sparkles, Star, Users, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { fontsHref } from "@/lib/site/templates";
import { AD_ASPECTS, AD_PALETTES, AD_STYLES, adLayout, adSize, brushPoints, fitFont, type AdAspect, type AdCopy, type AdIcon, type AdPalette, type AdStyle, type Box } from "@/lib/social/ad-creative-core";
import { aiAdCreativeAction } from "@/app/[locale]/(dashboard)/social/ad-actions";
import { createMediaUploadAction, saveAssetAction } from "@/app/[locale]/(dashboard)/social/studio-actions";
import { putBlob } from "./motion-studio";

/**
 * Ad creative studio — an agency-level ad poster: a cinematic AI key visual (no text) + a designed text layer drawn on a
 * canvas (3D glowing headline, brush-stroke offer badge with a big price, ribbon, benefits with icons, a glowing call to
 * action, a tagline). Hebrew is always spelled right because the letters are drawn here, not by the image model.
 * Everything is editable; "attach" uploads a sharp JPEG into the post.
 */
const ICONS: Record<AdIcon, typeof Zap> = { bolt: Zap, phone: Smartphone, chart: BarChart3, shield: ShieldCheck, star: Star, clock: Clock, heart: Heart, check: Check, gift: Gift, rocket: Rocket, sparkles: Sparkles, users: Users };
const DISPLAY = '"Rubik", "Heebo", system-ui, sans-serif';
const HAND = '"Suez One", "Secular One", Georgia, serif';

type Icons = Partial<Record<AdIcon, HTMLImageElement>>;

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

/** a headline with depth: an extrusion, a gradient face, a light rim and an outer glow */
function text3D(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, p: AdPalette) {
  const depth = Math.max(4, Math.round(px * 0.08));
  ctx.font = `900 ${px}px ${DISPLAY}`;
  ctx.lineJoin = "round";
  for (let i = depth; i > 0; i--) {
    ctx.fillStyle = p.depth;
    ctx.fillText(text, x + i * 0.6, y + i);
  }
  ctx.save();
  ctx.shadowColor = p.glow;
  ctx.shadowBlur = px * 0.45;
  const g = ctx.createLinearGradient(0, y - px * 0.85, 0, y + px * 0.1);
  g.addColorStop(0, p.head[0]);
  g.addColorStop(0.55, p.head[0]);
  g.addColorStop(1, p.head[1]);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  ctx.restore();
  ctx.lineWidth = Math.max(1.5, px * 0.025);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.strokeText(text, x, y);
}

export function drawAd(ctx: CanvasRenderingContext2D, aspect: AdAspect, img: HTMLImageElement | null, copy: AdCopy, style: AdStyle, rtl: boolean, icons: Icons) {
  const { w, h } = adSize(aspect);
  const p = AD_PALETTES[style];
  const L = adLayout(aspect, rtl);
  ctx.save();
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textBaseline = "alphabetic";
  // 1. the key visual (cover) or a rich gradient
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, w, h);
  if (img && img.naturalWidth) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    const ox = L.wide ? (rtl ? 0 : w - iw) : (w - iw) / 2;
    ctx.drawImage(img, ox, (h - ih) / 2, iw, ih);
  } else {
    const g = ctx.createRadialGradient(w * 0.3, h * 0.35, 10, w * 0.3, h * 0.35, Math.max(w, h));
    g.addColorStop(0, p.accent);
    g.addColorStop(0.35, p.depth);
    g.addColorStop(1, "#04060c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // 2. the veil where the text sits (the subject stays clear)
  if (L.wide) {
    const v = ctx.createLinearGradient(rtl ? w : 0, 0, rtl ? w * 0.25 : w * 0.75, 0);
    v.addColorStop(0, p.veil);
    v.addColorStop(0.55, p.veil.replace(/[\d.]+\)$/, "0.55)"));
    v.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  } else {
    const top = ctx.createLinearGradient(0, 0, 0, h * 0.32);
    top.addColorStop(0, p.veil);
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.32);
    const bot = ctx.createLinearGradient(0, h * 0.4, 0, h);
    bot.addColorStop(0, "rgba(0,0,0,0)");
    bot.addColorStop(0.25, p.veil);
    bot.addColorStop(1, p.veil);
    ctx.fillStyle = bot;
    ctx.fillRect(0, h * 0.4, w, h * 0.6);
  }
  // 3. a sweeping light arc + sparkles (premium feel)
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = p.glow;
  ctx.shadowColor = p.glow;
  ctx.shadowBlur = 30;
  ctx.lineWidth = Math.max(3, w * 0.004);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(L.headline.x + L.headline.w / 2, L.headline.y + L.headline.h * 0.55, L.headline.w * 0.56, L.headline.h * 0.62, -0.08, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const sx = ((i * 137.5) % 100) / 100;
    const sy = ((i * 61.8) % 100) / 100;
    ctx.globalAlpha = 0.25 + (i % 5) * 0.12;
    ctx.fillStyle = i % 3 ? "#ffffff" : p.accent;
    ctx.beginPath();
    ctx.arc(sx * w, sy * h, 1 + (i % 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const align = L.wide ? (rtl ? "right" : "left") : "center";
  const ax = (b: Box) => (align === "center" ? b.x + b.w / 2 : align === "right" ? b.x + b.w : b.x);
  ctx.textAlign = align;
  const measure = (weight: string, family: string) => (s: string, px: number) => {
    ctx.font = `${weight} ${px}px ${family}`;
    return ctx.measureText(s).width;
  };

  // 4. headline (3D) + sub line
  const hl = fitFont(copy.headline, L.headline, measure("900", DISPLAY), { max: Math.round(L.headline.h * 0.9), min: 40, maxLines: 2, lineHeight: 1.02 });
  hl.lines.forEach((line, i) => text3D(ctx, line, ax(L.headline), L.headline.y + hl.px * (0.92 + i * 1.02), hl.px, p));
  if (copy.sub) {
    const sb = fitFont(copy.sub, L.sub, measure("800", DISPLAY), { max: Math.round(L.sub.h * 0.75), min: 22, maxLines: 1 });
    ctx.font = `800 ${sb.px}px ${DISPLAY}`;
    ctx.fillStyle = p.ink;
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    // two soft shadow passes: the line stays readable even over a busy part of the picture
    ctx.shadowBlur = 22;
    ctx.fillText(sb.lines[0] ?? copy.sub, ax(L.sub), L.sub.y + sb.px);
    ctx.shadowBlur = 8;
    ctx.fillText(sb.lines[0] ?? copy.sub, ax(L.sub), L.sub.y + sb.px);
    ctx.shadowBlur = 0;
  }

  // 5. the brush-stroke offer badge with the price
  if (copy.badge || copy.price) {
    const b = L.badge;
    const bb: Box = { x: b.x, y: b.y + b.h * 0.04, w: b.w, h: b.h * 0.92 };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = p.badge;
    ctx.beginPath();
    brushPoints(bb, copy.badge.length + 3).forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const hasPrice = Boolean(copy.price);
    const lineH = hasPrice ? bb.h * 0.3 : bb.h * 0.6;
    const bf = fitFont(copy.badge, { w: bb.w * 0.9, h: lineH }, measure("900", DISPLAY), { max: Math.round(lineH * 0.8), min: 20, maxLines: hasPrice ? 1 : 2 });
    ctx.font = `900 ${bf.px}px ${DISPLAY}`;
    ctx.fillStyle = p.badgeText;
    const cx = bb.x + bb.w / 2;
    ctx.textAlign = "center";
    bf.lines.forEach((l, i) => ctx.fillText(l, cx, bb.y + (hasPrice ? bb.h * 0.08 : (bb.h - bf.lines.length * bf.px) / 2) + bf.px * (0.95 + i * 1.05)));
    if (hasPrice) {
      const pf = fitFont(copy.price, { w: bb.w * 0.62, h: bb.h * 0.58 }, measure("900", DISPLAY), { max: Math.round(bb.h * 0.58), min: 30, maxLines: 1 });
      const py = bb.y + bb.h * 0.9;
      const prev = { ...p, head: p.price as [string, string], depth: "#00000088", glow: p.price[0] };
      // the price and its prefix ("החל מ-") are one centred group; the prefix sits before the number in reading order
      ctx.font = `900 ${pf.px}px ${DISPLAY}`;
      const pw = ctx.measureText(copy.price).width;
      const prefixPx = Math.round(pf.px * 0.3);
      ctx.font = `800 ${prefixPx}px ${DISPLAY}`;
      const fw = copy.pricePrefix ? ctx.measureText(copy.pricePrefix).width + prefixPx * 0.5 : 0;
      const groupStart = cx - (pw + fw) / 2;
      const priceCx = rtl ? groupStart + pw / 2 : groupStart + fw + pw / 2;
      ctx.save();
      ctx.textAlign = "center";
      text3D(ctx, copy.price, priceCx, py, pf.px, prev);
      ctx.restore();
      if (copy.pricePrefix) {
        ctx.font = `800 ${prefixPx}px ${DISPLAY}`;
        ctx.fillStyle = p.badgeText;
        ctx.textAlign = "center";
        ctx.fillText(copy.pricePrefix, rtl ? groupStart + pw + fw / 2 : groupStart + (fw - prefixPx * 0.5) / 2, py - pf.px * 0.42);
      }
    }
    ctx.textAlign = align;
  }

  // 6. ribbon
  if (copy.ribbon) {
    const r = L.ribbon;
    ctx.font = `800 ${Math.round(r.h * 0.46)}px ${DISPLAY}`;
    const tw = Math.min(r.w, ctx.measureText(`★  ${copy.ribbon}`).width + r.h * 1.2);
    const rb: Box = { x: align === "center" ? r.x + (r.w - tw) / 2 : align === "right" ? r.x + r.w - tw : r.x, y: r.y + r.h * 0.12, w: tw, h: r.h * 0.76 };
    ctx.save();
    roundRect(ctx, rb, rb.h / 2);
    ctx.fillStyle = "rgba(4,8,20,0.78)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.accent;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = p.ink;
    ctx.textAlign = "center";
    ctx.fillText(`★  ${copy.ribbon}`, rb.x + rb.w / 2, rb.y + rb.h * 0.68);
    ctx.textAlign = align;
  }

  // 7. benefits with icons and thin separators
  const feats = copy.features.slice(0, 4);
  if (feats.length) {
    const f = L.features;
    const cell = f.w / feats.length;
    const iconSize = Math.min(f.h * 0.48, cell * 0.36);
    feats.forEach((ft, i) => {
      const idx = rtl ? feats.length - 1 - i : i;
      const cx = f.x + cell * idx + cell / 2;
      const icon = icons[ft.icon];
      if (icon) {
        ctx.save();
        ctx.shadowColor = p.glow;
        ctx.shadowBlur = 16;
        ctx.drawImage(icon, cx - iconSize / 2, f.y, iconSize, iconSize);
        ctx.restore();
      }
      const lf = fitFont(ft.label, { w: cell * 0.92, h: f.h * 0.34 }, measure("700", DISPLAY), { max: Math.round(f.h * 0.24), min: 16, maxLines: 1 });
      ctx.font = `700 ${lf.px}px ${DISPLAY}`;
      ctx.fillStyle = p.ink;
      ctx.textAlign = "center";
      ctx.fillText(lf.lines[0] ?? ft.label, cx, f.y + iconSize + lf.px * 1.25);
      if (idx > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(f.x + cell * idx, f.y + f.h * 0.05);
        ctx.lineTo(f.x + cell * idx, f.y + f.h * 0.85);
        ctx.stroke();
      }
    });
    ctx.textAlign = align;
  }

  // 8. the glowing call to action
  if (copy.cta) {
    const c = L.cta;
    ctx.save();
    roundRect(ctx, c, c.h / 2);
    const g = ctx.createLinearGradient(c.x, c.y, c.x, c.y + c.h);
    g.addColorStop(0, "rgba(10,20,45,0.95)");
    g.addColorStop(1, "rgba(4,8,20,0.95)");
    ctx.fillStyle = g;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 34;
    ctx.fill();
    ctx.lineWidth = Math.max(3, c.h * 0.05);
    ctx.strokeStyle = p.accent;
    ctx.stroke();
    ctx.restore();
    const cf = fitFont(`${copy.cta}`, { w: c.w * 0.62, h: c.h * 0.6 }, measure("900", DISPLAY), { max: Math.round(c.h * 0.46), min: 18, maxLines: 1 });
    ctx.font = `900 ${cf.px}px ${DISPLAY}`;
    ctx.fillStyle = p.ink;
    ctx.textAlign = "center";
    ctx.fillText(cf.lines[0] ?? copy.cta, c.x + c.w / 2, c.y + c.h / 2 + cf.px * 0.36);
    ctx.font = `900 ${Math.round(cf.px * 1.1)}px ${DISPLAY}`;
    ctx.fillStyle = p.badge;
    ctx.fillText(rtl ? "«" : "»", rtl ? c.x + c.h * 0.6 : c.x + c.w - c.h * 0.6, c.y + c.h / 2 + cf.px * 0.38);
    const rk = icons.rocket;
    if (rk) ctx.drawImage(rk, rtl ? c.x + c.w - c.h * 0.95 : c.x + c.h * 0.3, c.y + c.h * 0.2, c.h * 0.6, c.h * 0.6);
    ctx.textAlign = align;
  }

  // 9. tagline with a brush underline
  if (copy.tagline) {
    const tg = L.tagline;
    const tf = fitFont(copy.tagline, { w: tg.w * 0.92, h: tg.h * 0.7 }, measure("400", HAND), { max: Math.round(tg.h * 0.56), min: 18, maxLines: 1 });
    ctx.font = `400 ${tf.px}px ${HAND}`;
    ctx.fillStyle = p.ink;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    const tx = ax(tg);
    const ty = tg.y + tf.px * 1.05;
    ctx.fillText(tf.lines[0] ?? copy.tagline, tx, ty);
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(tf.lines[0] ?? copy.tagline).width;
    const sx = align === "center" ? tx - tw / 2 : align === "right" ? tx - tw : tx;
    ctx.strokeStyle = p.badge;
    ctx.lineWidth = Math.max(3, tf.px * 0.09);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx + tw * 0.08, ty + tf.px * 0.28);
    ctx.quadraticCurveTo(sx + tw * 0.5, ty + tf.px * 0.12, sx + tw * 0.94, ty + tf.px * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

export function AdCreativeStudio({ body, image, ig, onImage }: { body: string; image: string; ig: boolean; onImage: (url: string) => void }) {
  const { t, locale } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const iconBox = useRef<HTMLDivElement | null>(null);
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<AdStyle>("neon");
  const [aspect, setAspect] = useState<AdAspect>(ig ? "4:5" : "1:1");
  const [newImage, setNewImage] = useState(!image);
  const [bg, setBg] = useState<string>(image);
  const [copy, setCopy] = useState<AdCopy | null>(null);
  const [busy, setBusy] = useState<null | "make" | "save">(null);
  const [loaded, setLoaded] = useState<{ src: string; el: HTMLImageElement } | null>(null);
  const [icons, setIcons] = useState<Icons>({});
  const [fontsReady, setFontsReady] = useState(false);
  const rtl = locale !== "en";
  const { w, h } = adSize(aspect);

  // display fonts for the poster (Hebrew-friendly) — the canvas waits for them
  useEffect(() => {
    const href = fontsHref(["rubik", "suez", "secular"]);
    if (href && !document.querySelector(`link[data-ad-fonts]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href.replace("Rubik:wght@400;500;700;800", "Rubik:wght@700;800;900");
      l.dataset.adFonts = "1";
      document.head.appendChild(l);
    }
    let alive = true;
    void Promise.all([document.fonts.load(`900 64px Rubik`), document.fonts.load(`400 40px "Suez One"`)])
      .catch(() => undefined)
      .then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // the benefit icons, rasterised from the same icon set the app uses (white strokes)
  useEffect(() => {
    const box = iconBox.current;
    if (!box) return;
    const out: Icons = {};
    let left = 0;
    box.querySelectorAll<SVGElement>("svg[data-icon]").forEach((svg) => {
      const key = svg.dataset.icon as AdIcon;
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute("stroke", "#ffffff");
      clone.setAttribute("width", "96");
      clone.setAttribute("height", "96");
      const im = new Image();
      left++;
      im.onload = () => {
        out[key] = im;
        if (--left === 0) setIcons({ ...out });
      };
      im.onerror = () => (--left === 0 ? setIcons({ ...out }) : undefined);
      im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
    });
  }, []);

  // the key visual (CORS-enabled so the poster can be exported); only the picture that belongs to `bg` is used
  useEffect(() => {
    if (!bg) return;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => setLoaded({ src: bg, el: im });
    im.src = bg;
  }, [bg]);
  const img = bg && loaded?.src === bg ? loaded.el : null;

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !copy) return;
    drawAd(ctx, aspect, img, copy, style, rtl, icons);
  }, [aspect, img, copy, style, rtl, icons]);

  useEffect(() => {
    draw();
  }, [draw, fontsReady, w, h]);

  const make = async () => {
    const text = (topic.trim() || body.trim()).slice(0, 1200);
    if (text.length < 3) return void toast.error(t("social.ad.needTopic"));
    setBusy("make");
    const r = await aiAdCreativeAction({ locale, topic: text, style, aspect, withImage: newImage || !bg });
    setBusy(null);
    if (r.error || !r.data) return void toast.error(t(r.error ?? "ai.failed"));
    setCopy(r.data.copy);
    if (r.data.imageUrl) setBg(r.data.imageUrl);
    if (r.data.imageError) toast.message(t("social.ad.noImage"));
  };

  const attach = async () => {
    const c = canvasRef.current;
    if (!c || !copy) return;
    setBusy("save");
    try {
      draw();
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.94));
      if (!blob) throw new Error("x");
      const up = await createMediaUploadAction({ locale, type: "image/jpeg", size: blob.size });
      if (up.error || !up.data) throw new Error(up.error ?? "x");
      await putBlob(up.data.signedUrl, blob, "image/jpeg", () => undefined);
      onImage(up.data.publicUrl);
      void saveAssetAction({ locale, url: up.data.publicUrl, title: copy.headline.slice(0, 120) });
      toast.success(t("social.ad.attached"));
    } catch {
      toast.error(t("social.ad.failed"));
    } finally {
      setBusy(null);
    }
  };

  const edit = (k: keyof AdCopy, v: string) => copy && setCopy({ ...copy, [k]: v });
  const sel = "h-9 rounded-lg border border-line bg-elevated px-2 text-[13px]";

  return (
    <div className="space-y-3 rounded-xl border border-line bg-elevated p-3" data-testid="ad-studio">
      <div ref={iconBox} className="hidden" aria-hidden>
        {(Object.keys(ICONS) as AdIcon[]).map((k) => {
          const I = ICONS[k];
          return <I key={k} data-icon={k} />;
        })}
      </div>
      <div className="flex items-start gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-sm">
          <Megaphone className="h-4.5 w-4.5" />
        </span>
        <div>
          <p className="text-[13.5px] font-semibold">{t("social.ad.title")}</p>
          <p className="text-[12px] text-muted">{t("social.ad.hint")}</p>
        </div>
      </div>
      <Textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={body.trim() ? t("social.ad.fromPost") : t("social.ad.placeholder")} dir="auto" maxLength={1200} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("social.ad.style")}>
          {AD_STYLES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(s)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", style === s ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent")}>
              <span className="h-3 w-3 rounded-full" style={{ background: `linear-gradient(135deg, ${AD_PALETTES[s].accent}, ${AD_PALETTES[s].badge})` }} aria-hidden />
              {t(`social.ad.styles.${s}`)}
            </button>
          ))}
        </div>
        <select className={sel} value={aspect} onChange={(e) => setAspect(e.target.value as AdAspect)} aria-label={t("social.ad.aspect")}>
          {AD_ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {image ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            <input type="checkbox" checked={newImage} onChange={(e) => setNewImage(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" /> {t("social.ad.newImage")}
          </label>
        ) : null}
        <Button size="sm" onClick={() => void make()} disabled={busy !== null} data-testid="ad-make">
          {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {copy ? t("social.ad.again") : t("social.ad.make")}
        </Button>
      </div>
      {copy ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <canvas ref={canvasRef} width={w} height={h} className="w-full rounded-xl border border-line shadow-lg" style={{ aspectRatio: `${w} / ${h}` }} data-testid="ad-canvas" />
          <div className="space-y-2">
            {(["headline", "sub", "badge", "pricePrefix", "price", "ribbon", "cta", "tagline"] as const).map((k) => (
              <label key={k} className="block text-[12px] text-muted">
                {t(`social.ad.fields.${k}`)}
                <Input value={copy[k]} onChange={(e) => edit(k, e.target.value)} dir="auto" className="h-9 text-[13px]" />
              </label>
            ))}
            <div className="grid grid-cols-2 gap-2">
              {copy.features.map((f, i) => (
                <div key={i} className="flex gap-1">
                  <Select className="h-9 w-16 px-1 text-[12px]" value={f.icon} onChange={(e) => setCopy({ ...copy, features: copy.features.map((x, j) => (j === i ? { ...x, icon: e.target.value as AdIcon } : x)) })} aria-label={t("social.ad.icon")}>
                    {(Object.keys(ICONS) as AdIcon[]).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                  <Input value={f.label} onChange={(e) => setCopy({ ...copy, features: copy.features.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} dir="auto" className="h-9 text-[13px]" />
                </div>
              ))}
            </div>
            <Button onClick={() => void attach()} disabled={busy !== null} className="w-full" data-testid="ad-attach">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("social.ad.attach")}
            </Button>
            <p className="text-[11.5px] text-subtle">{t("social.ad.cost")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
