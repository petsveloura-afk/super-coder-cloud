/**
 * Wave 61 — Motion Studio math (pure, unit-tested): canvas sizes per format, easing, the "cover" crop with a
 * slow camera move (Ken Burns), text wrapping that works for Hebrew / Arabic, the timeline of each template
 * and the best recorder format the browser supports (MP4 first — Instagram Reels need it).
 */

export type MotionAspect = "1:1" | "4:5" | "9:16" | "16:9";
export type MotionTemplate = "kenburns" | "tilt3d" | "float" | "neon" | "reveal" | "split";

export const MOTION_TEMPLATES: MotionTemplate[] = ["kenburns", "tilt3d", "float", "neon", "reveal", "split"];
export const MOTION_ASPECTS: MotionAspect[] = ["1:1", "4:5", "9:16", "16:9"];

/** Output size (kept ≤ 1080 on the short side so recording stays smooth on phones). */
export function canvasSize(aspect: MotionAspect): { w: number; h: number } {
  switch (aspect) {
    case "9:16":
      return { w: 720, h: 1280 };
    case "4:5":
      return { w: 864, h: 1080 };
    case "16:9":
      return { w: 1280, h: 720 };
    default:
      return { w: 1080, h: 1080 };
  }
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (x: number) => {
  const t = clamp01(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Progress of a segment [a, b] inside 0..1. */
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / Math.max(0.0001, b - a));

/** Source rect that covers the target with `zoom` and a pan (-1..1 on each axis). */
export function coverRect(imgW: number, imgH: number, w: number, h: number, zoom = 1, panX = 0, panY = 0): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(w / imgW, h / imgH) * Math.max(1, zoom);
  const sw = w / scale;
  const sh = h / scale;
  const maxX = (imgW - sw) / 2;
  const maxY = (imgH - sh) / 2;
  return { sx: maxX + maxX * Math.max(-1, Math.min(1, panX)), sy: maxY + maxY * Math.max(-1, Math.min(1, panY)), sw, sh };
}

/** Slow camera move: zoom 1 → 1.18 with a gentle diagonal pan (seeded so each video moves differently). */
export function kenBurns(p: number, seed = 0): { zoom: number; panX: number; panY: number } {
  const e = easeInOutCubic(p);
  const dir = seed % 4;
  const dx = dir === 0 || dir === 3 ? 1 : -1;
  const dy = dir < 2 ? 1 : -1;
  return { zoom: 1.04 + 0.14 * e, panX: dx * (-0.6 + 1.2 * e), panY: dy * (-0.4 + 0.8 * e) };
}

/** Wraps text into lines that fit `maxW` (measure = ctx.measureText(...).width); at most `maxLines`. */
export function wrapLines(text: string, maxW: number, measure: (s: string) => number, maxLines = 4): string[] {
  const words = (text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[.,!?…]*$/, "")}…`;
  return kept;
}

export const isRtl = (s: string) => /[֐-׿؀-ۿ]/.test(s ?? "");

/** The headline for the video: the post's first line without emojis / hashtags (≤ 70 chars). */
export function headlineFrom(text: string): string {
  const first = (text ?? "").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
  return first
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

/** Recorder formats, best first. Instagram needs MP4 (H.264); WebM is fine for Facebook and Telegram. */
export const RECORDER_TYPES = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
export function pickRecorderType(isSupported: (t: string) => boolean): string | null {
  return RECORDER_TYPES.find((t) => {
    try {
      return isSupported(t);
    } catch {
      return false;
    }
  }) ?? null;
}

/** The plain MIME type the upload check accepts ("video/mp4;codecs=…" → "video/mp4"). */
export const baseMime = (t: string) => (t || "").split(";")[0]!.trim().toLowerCase();

/** Timeline: intro (headline in), middle (sub line), outro (call to action card). */
export function timeline(p: number): { headline: number; sub: number; cta: number; fadeOut: number } {
  return { headline: easeOutBack(seg(p, 0.06, 0.24)), sub: easeOutCubic(seg(p, 0.3, 0.45)), cta: easeOutBack(seg(p, 0.66, 0.8)), fadeOut: seg(p, 0.94, 1) };
}

/** Brand palettes (two gradient stops + text color). */
export const MOTION_PALETTES: { key: string; a: string; b: string; text: string }[] = [
  { key: "ocean", a: "#2f63e8", b: "#14b8a6", text: "#ffffff" },
  { key: "sunset", a: "#f97316", b: "#db2777", text: "#ffffff" },
  { key: "royal", a: "#6d28d9", b: "#2563eb", text: "#ffffff" },
  { key: "gold", a: "#1f2937", b: "#c9a66b", text: "#fff7e6" },
  { key: "mint", a: "#059669", b: "#a3e635", text: "#06281d" },
  { key: "noir", a: "#0b0b12", b: "#3f3f46", text: "#f4f4f5" },
];
