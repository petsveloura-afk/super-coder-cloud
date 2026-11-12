/**
 * Post picture editor — the math (pure, unit-tested). The browser draws with these numbers on a canvas:
 *   • frames: the sizes each network shows best (square / portrait 4:5 / landscape / story 9:16)
 *   • cover crop with zoom + focal point (the part of the photo that stays in the frame)
 *   • adjustments → one CSS/canvas filter string; ready-made looks
 *   • headline overlay: band position, line wrapping, readable text color on any brand color
 */

export const FRAMES = {
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
  landscape: { w: 1200, h: 630 },
  story: { w: 1080, h: 1920 },
} as const;
export type FrameKey = keyof typeof FRAMES;

export interface Adjust {
  brightness: number; // 50..150 (%)
  contrast: number; // 50..150
  saturation: number; // 0..200
  warmth: number; // -50..50 (sepia / hue shift)
  blur: number; // 0..6 (px)
  vignette: number; // 0..80 (%)
}

export const DEFAULT_ADJUST: Adjust = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0, vignette: 0 };

export const LOOKS: Record<string, Adjust> = {
  natural: DEFAULT_ADJUST,
  vivid: { brightness: 104, contrast: 112, saturation: 135, warmth: 0, blur: 0, vignette: 10 },
  warm: { brightness: 104, contrast: 104, saturation: 112, warmth: 22, blur: 0, vignette: 15 },
  cool: { brightness: 102, contrast: 106, saturation: 95, warmth: -20, blur: 0, vignette: 10 },
  mono: { brightness: 104, contrast: 118, saturation: 0, warmth: 0, blur: 0, vignette: 25 },
  cinematic: { brightness: 96, contrast: 124, saturation: 88, warmth: 8, blur: 0, vignette: 45 },
  soft: { brightness: 108, contrast: 90, saturation: 92, warmth: 10, blur: 0, vignette: 0 },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));

export function normalizeAdjust(a: Partial<Adjust>): Adjust {
  return {
    brightness: clamp(a.brightness ?? 100, 50, 150),
    contrast: clamp(a.contrast ?? 100, 50, 150),
    saturation: clamp(a.saturation ?? 100, 0, 200),
    warmth: clamp(a.warmth ?? 0, -50, 50),
    blur: clamp(a.blur ?? 0, 0, 6),
    vignette: clamp(a.vignette ?? 0, 0, 80),
  };
}

/** one filter string for canvas (ctx.filter) and for the live CSS preview */
export function filterString(input: Partial<Adjust>): string {
  const a = normalizeAdjust(input);
  const parts = [`brightness(${a.brightness}%)`, `contrast(${a.contrast}%)`, `saturate(${a.saturation}%)`];
  if (a.warmth > 0) parts.push(`sepia(${Math.round(a.warmth * 0.8)}%)`);
  if (a.warmth < 0) parts.push(`hue-rotate(${Math.round(a.warmth * 0.6)}deg)`);
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`);
  return parts.join(" ");
}

/**
 * Cover crop: which rectangle of the source image fills the frame. zoom ≥ 1 enlarges; focus (0..1) chooses which part
 * stays in view (0.5 / 0.5 = the center). The rectangle always lies inside the image.
 */
export function coverCrop(src: { w: number; h: number }, frame: { w: number; h: number }, zoom = 1, focusX = 0.5, focusY = 0.5): { sx: number; sy: number; sw: number; sh: number } {
  const z = clamp(zoom, 1, 4);
  const scale = Math.max(frame.w / src.w, frame.h / src.h) * z;
  const sw = Math.min(src.w, frame.w / scale);
  const sh = Math.min(src.h, frame.h / scale);
  const sx = clamp(clamp(focusX, 0, 1) * src.w - sw / 2, 0, src.w - sw);
  const sy = clamp(clamp(focusY, 0, 1) * src.h - sh / 2, 0, src.h - sh);
  return { sx, sy, sw, sh };
}

/** black or white text, whichever reads better on the band color (WCAG relative luminance) */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return L > 0.4 ? "#111111" : "#ffffff";
}

/** greedy word wrap with a measuring function (canvas measureText in the browser); at most maxLines, the last one gets "…" */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 3): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1).trimEnd();
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

export type BandPos = "top" | "center" | "bottom";

/** the headline band: font size relative to the frame, padding and the band's rectangle */
export function bandLayout(frame: { w: number; h: number }, lines: number, pos: BandPos): { font: number; pad: number; y: number; h: number; lineH: number } {
  const font = Math.round(Math.min(frame.w, frame.h) * 0.068);
  const lineH = Math.round(font * 1.25);
  const pad = Math.round(font * 0.7);
  const h = lines * lineH + pad * 2;
  const y = pos === "top" ? Math.round(frame.h * 0.06) : pos === "center" ? Math.round((frame.h - h) / 2) : Math.round(frame.h - h - frame.h * 0.06);
  return { font, pad, y, h, lineH };
}

/** true when the text is mainly right-to-left (Hebrew / Arabic) */
export function isRtlText(s: string): boolean {
  const rtl = (s.match(/[֐-ࣿ]/g) ?? []).length;
  const ltr = (s.match(/[A-Za-z]/g) ?? []).length;
  return rtl > ltr;
}
