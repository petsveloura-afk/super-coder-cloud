/**
 * Ad creative studio — the pure parts (unit-tested). A marketing poster like the big agencies make: a cinematic AI
 * key visual (no text — models still misspell Hebrew) + a designed, pixel-perfect text layer drawn on a canvas:
 * a 3D glowing headline, a sub-line, a brush-stroke offer badge with a big price, a ribbon, a row of benefits with
 * icons, a glowing call-to-action pill and a handwritten-style tagline. Everything here is layout + data; drawing is in
 * components/social/ad-creative-studio.tsx.
 */
export type AdAspect = "1:1" | "4:5" | "9:16" | "16:9";
export const AD_ASPECTS: AdAspect[] = ["1:1", "4:5", "9:16", "16:9"];
export const AD_STYLES = ["neon", "luxury", "bold", "fresh", "tech", "warm"] as const;
export type AdStyle = (typeof AD_STYLES)[number];
/** icons the copywriter may pick for a benefit (drawn from lucide paths in the studio) */
export const AD_ICONS = ["bolt", "phone", "chart", "shield", "star", "clock", "heart", "check", "gift", "rocket", "sparkles", "users"] as const;
export type AdIcon = (typeof AD_ICONS)[number];

export interface AdCopy {
  /** 1-3 strong words — the big 3D line (a brand or the core promise) */
  headline: string;
  /** one line under it */
  sub: string;
  /** the offer line on the brush badge (e.g. "דף נחיתה מקצועי") */
  badge: string;
  /** ONLY a price the person wrote (e.g. "450₪") — empty otherwise */
  price: string;
  /** small line before the price ("החל מ-") */
  pricePrefix: string;
  /** a short ribbon line (e.g. "ברמה הגבוהה ביותר") */
  ribbon: string;
  features: { label: string; icon: AdIcon }[];
  cta: string;
  tagline: string;
}

export interface AdPalette {
  /** headline gradient (top → bottom) */
  head: [string, string];
  /** extrusion / depth colour */
  depth: string;
  glow: string;
  badge: string;
  badgeText: string;
  price: [string, string];
  ink: string;
  muted: string;
  accent: string;
  /** veil over the image on the text side */
  veil: string;
}

export const AD_PALETTES: Record<AdStyle, AdPalette> = {
  neon: { head: ["#f5f7ff", "#3aa0ff"], depth: "#0b2a6b", glow: "#2f8cff", badge: "#ffd21f", badgeText: "#0a1a3a", price: ["#1d6dff", "#0a2a7a"], ink: "#ffffff", muted: "#c7d6ff", accent: "#2f8cff", veil: "rgba(4,10,30,0.82)" },
  luxury: { head: ["#fff6dd", "#c9a24d"], depth: "#3a2a08", glow: "#e2b85a", badge: "#c9a24d", badgeText: "#120c02", price: ["#fff1c9", "#b8892f"], ink: "#fffaf0", muted: "#e9dcc0", accent: "#e2b85a", veil: "rgba(8,6,2,0.84)" },
  bold: { head: ["#ffffff", "#ffdd00"], depth: "#7a0016", glow: "#ff2e4d", badge: "#ff2e4d", badgeText: "#ffffff", price: ["#ffffff", "#ffd400"], ink: "#ffffff", muted: "#ffe6ea", accent: "#ff2e4d", veil: "rgba(25,0,6,0.8)" },
  fresh: { head: ["#ffffff", "#7cf0c8"], depth: "#04463a", glow: "#19d3a2", badge: "#ffffff", badgeText: "#06372e", price: ["#19d3a2", "#047a5f"], ink: "#ffffff", muted: "#d5fff3", accent: "#19d3a2", veil: "rgba(2,30,26,0.78)" },
  tech: { head: ["#f0fdff", "#22d3ee"], depth: "#062a3a", glow: "#22d3ee", badge: "#a855f7", badgeText: "#ffffff", price: ["#e9d5ff", "#7c3aed"], ink: "#ffffff", muted: "#cffafe", accent: "#22d3ee", veil: "rgba(3,8,24,0.84)" },
  warm: { head: ["#fff7ed", "#fb923c"], depth: "#5a1f05", glow: "#fb923c", badge: "#fde68a", badgeText: "#431407", price: ["#ea580c", "#7c2d12"], ink: "#fffaf3", muted: "#ffedd5", accent: "#fb923c", veil: "rgba(30,10,2,0.8)" },
};

export function adSize(aspect: AdAspect): { w: number; h: number } {
  switch (aspect) {
    case "4:5":
      return { w: 1080, h: 1350 };
    case "9:16":
      return { w: 1080, h: 1920 };
    case "16:9":
      return { w: 1920, h: 1080 };
    default:
      return { w: 1080, h: 1080 };
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AdLayout {
  /** the text column (right in RTL / left in LTR on wide frames; full width on tall ones) */
  col: Box;
  headline: Box;
  sub: Box;
  badge: Box;
  ribbon: Box;
  features: Box;
  cta: Box;
  tagline: Box;
  /** where the picture's subject should stay visible (veil fades towards it) */
  imageSide: "start" | "end" | "top";
  wide: boolean;
}

/** the poster grid for a frame (RTL keeps the text on the right, the product on the left — like Hebrew ads) */
export function adLayout(aspect: AdAspect, rtl: boolean): AdLayout {
  const { w, h } = adSize(aspect);
  const pad = Math.round(Math.min(w, h) * 0.055);
  const wide = aspect === "16:9";
  if (wide) {
    const cw = Math.round(w * 0.52);
    const x = rtl ? w - cw - pad : pad;
    const at = (y: number, hh: number): Box => ({ x, y: Math.round(y), w: cw, h: Math.round(hh) });
    return {
      col: at(pad, h - 2 * pad),
      headline: at(h * 0.07, h * 0.24),
      sub: at(h * 0.31, h * 0.07),
      badge: at(h * 0.4, h * 0.25),
      ribbon: at(h * 0.66, h * 0.07),
      features: at(h * 0.75, h * 0.11),
      cta: { x: rtl ? pad : w - pad - Math.round(w * 0.3), y: Math.round(h * 0.82), w: Math.round(w * 0.3), h: Math.round(h * 0.11) },
      tagline: at(h * 0.88, h * 0.07),
      imageSide: rtl ? "start" : "end",
      wide,
    };
  }
  // tall / square: the headline over the top, the picture's subject clear in the middle, the offer block below
  const tall = h / w;
  const x = pad;
  const cw = w - 2 * pad;
  const top = h * (tall > 1.5 ? 0.56 : tall > 1.1 ? 0.52 : 0.49);
  const rest = h - top - pad;
  const at = (f: number, hf: number): Box => ({ x, y: Math.round(top + rest * f), w: cw, h: Math.round(rest * hf) });
  return {
    col: { x, y: Math.round(top), w: cw, h: Math.round(rest) },
    headline: { x, y: pad, w: cw, h: Math.round(h * (tall > 1.5 ? 0.13 : 0.15)) },
    sub: { x, y: Math.round(pad + h * (tall > 1.5 ? 0.135 : 0.155)), w: cw, h: Math.round(h * 0.05) },
    badge: at(0.0, 0.3),
    ribbon: at(0.33, 0.1),
    features: at(0.47, 0.19),
    cta: { x: Math.round(w * 0.18), y: Math.round(top + rest * 0.7), w: Math.round(w * 0.64), h: Math.round(rest * 0.15) },
    tagline: at(0.88, 0.12),
    imageSide: "top",
    wide,
  };
}

/** biggest font size (px) at which `text` fits the box on `maxLines` lines */
export function fitFont(text: string, box: { w: number; h: number }, measure: (s: string, px: number) => number, opts: { max: number; min: number; lineHeight?: number; maxLines?: number }): { px: number; lines: string[] } {
  const lh = opts.lineHeight ?? 1.08;
  const maxLines = opts.maxLines ?? 2;
  for (let px = opts.max; px >= opts.min; px -= 2) {
    const lines = wrap(text, box.w, (s) => measure(s, px), maxLines);
    if (lines.length <= maxLines && lines.every((l) => measure(l, px) <= box.w) && lines.length * px * lh <= box.h) return { px, lines };
  }
  return { px: opts.min, lines: wrap(text, box.w, (s) => measure(s, opts.min), maxLines) };
}

function wrap(text: string, maxW: number, measure: (s: string) => number, maxLines: number): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
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
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    return [...head, lines.slice(maxLines - 1).join(" ")];
  }
  return lines;
}

/** a hand-painted brush stroke around a box (deterministic for a seed) — the yellow offer badge */
export function brushPoints(box: Box, seed = 1, steps = 26): { x: number; y: number }[] {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const pts: { x: number; y: number }[] = [];
  const jag = Math.max(4, box.h * 0.06);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: box.x + box.w * t, y: box.y + (rnd() - 0.5) * jag + (i % 2 ? jag * 0.4 : 0) });
  }
  for (let i = 0; i <= Math.round(steps / 4); i++) pts.push({ x: box.x + box.w + (rnd() * jag * 1.6), y: box.y + (box.h * i) / Math.round(steps / 4) });
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    pts.push({ x: box.x + box.w * t, y: box.y + box.h + (rnd() - 0.5) * jag - (i % 2 ? jag * 0.4 : 0) });
  }
  for (let i = Math.round(steps / 4); i >= 0; i--) pts.push({ x: box.x - rnd() * jag * 1.6, y: box.y + (box.h * i) / Math.round(steps / 4) });
  return pts;
}

/* ------------------------------------------------------------------ copy from the AI */

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** a price only when the person wrote one (digits from their own text) — the AI never invents prices */
export function priceFrom(userText: string, aiPrice: string): string {
  const own = String(userText ?? "");
  const digits = (aiPrice.match(/\d[\d,.]*/) ?? [""])[0]!.replace(/[,.]$/, "");
  if (!digits || !own.replace(/[,\s]/g, "").includes(digits.replace(/[,\s]/g, ""))) return "";
  const cur = /₪|ש"ח|ש״ח|שקל|nis|ils/i.test(own) || /₪/.test(aiPrice) ? "₪" : /\$/.test(own + aiPrice) ? "$" : /€/.test(own + aiPrice) ? "€" : "₪";
  return `${digits}${cur}`;
}

export function parseAdCopy(raw: string, userText: string): AdCopy | null {
  const s = String(raw ?? "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const headline = str(j.headline, 40);
  if (!headline) return null;
  const feats = (Array.isArray(j.features) ? j.features : [])
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const icon = (AD_ICONS as readonly string[]).includes(String(o.icon)) ? (o.icon as AdIcon) : "check";
      return { label: str(o.label, 24), icon };
    })
    .filter((f) => f.label)
    .slice(0, 4);
  return {
    headline,
    sub: str(j.sub, 70),
    badge: str(j.badge, 40),
    price: priceFrom(userText, str(j.price, 20)),
    pricePrefix: str(j.pricePrefix, 16),
    ribbon: str(j.ribbon, 44),
    features: feats,
    cta: str(j.cta, 26) || "",
    tagline: str(j.tagline, 70),
  };
}

export const AD_COPY_SYSTEM = [
  "You are the creative director of a top advertising agency. Write the copy for ONE scroll-stopping social media ad poster.",
  "Write in the SAME language as the request (Hebrew stays Hebrew). Short, punchy, premium — every word earns its place.",
  "NEVER invent prices, discounts, dates or claims. \"price\" only if the request contains a price (copy it exactly), otherwise \"\".",
  'Answer with ONE JSON object only: {"headline": "1-3 words, the brand or the core promise", "sub": "one line, max 6 words", "badge": "the offer, max 4 words", "pricePrefix": "e.g. החל מ- (only with a price)", "price": "", "ribbon": "a short premium line, max 5 words", "features": [{"label": "max 2 words", "icon": "bolt|phone|chart|shield|star|clock|heart|check|gift|rocket|sparkles|users"}] (exactly 4), "cta": "max 3 words", "tagline": "a short memorable line, max 7 words"}',
].join("\n");

/** the key visual prompt: a cinematic advertising scene with the product, and calm empty space where the text goes */
export function adVisualPrompt(subjectEn: string, style: AdStyle, aspect: AdAspect, rtl: boolean): string {
  const look: Record<AdStyle, string> = {
    neon: "night city bokeh, electric blue neon rim light, glossy reflections, futuristic premium tech advertising",
    luxury: "black and gold, warm spotlight, marble and brass, premium luxury advertising, shallow depth of field",
    bold: "high-energy commercial look, saturated red and yellow accents, dynamic light streaks",
    fresh: "bright clean studio, teal and mint accents, soft daylight, fresh modern advertising",
    tech: "dark futuristic workspace, cyan and violet neon glow, holographic light trails, sleek tech advertising",
    warm: "golden-hour warmth, cozy amber light, soft bokeh, inviting lifestyle advertising",
  };
  const side = aspect === "16:9" ? `the subject on the ${rtl ? "left" : "right"} third, the ${rtl ? "right" : "left"} half dark and empty for a headline` : "the subject in the upper part of the frame, the lower part dark and calm for text";
  return `Advertising key visual: ${subjectEn}. ${look[style]}. Cinematic product photography, dramatic lighting, ultra-detailed, 8k, sharp focus, professional color grading, depth and atmosphere. Composition: ${side}. Strictly no text, letters, numbers, logos or watermarks anywhere in the image.`;
}
