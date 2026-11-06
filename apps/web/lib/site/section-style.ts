/**
 * Section design + one-click style packs (pure, unit-tested) — the "section inspector" and "site styles" of a page
 * builder. Section styles become data attributes on the section (site-pro.css); packs set the site-wide design AND a
 * professional rhythm of section backgrounds / entrances in one step (everything stays editable afterwards).
 */
import { SECTION_ANIMS, SECTION_BGS, type BlockStyle } from "@scc/shared/engagement";

export type SectionAnim = (typeof SECTION_ANIMS)[number];
export type SectionBg = (typeof SECTION_BGS)[number];
export const SECTION_PADS = ["auto", "compact", "roomy"] as const;
export const SECTION_ALIGNS = ["auto", "start", "center"] as const;
export const SECTION_HIDES = ["none", "mobile", "desktop"] as const;
export const SITE_BUTTONS = ["solid", "gradient", "outline", "glass", "pill"] as const;
export const SITE_HOVERS = ["lift", "glow", "tilt", "none"] as const;
export const SITE_ENTRANCES = ["rise", "fade", "scale", "slide", "blur", "flip"] as const;
export const SITE_HEADERS = ["glass", "solid", "minimal"] as const;

const inList = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** a clean style (unknown / default values removed); null when nothing is set */
export function cleanSectionStyle(s: unknown): BlockStyle | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const out: BlockStyle = {};
  if (inList(o.anim, SECTION_ANIMS) && o.anim !== "auto") out.anim = o.anim;
  if (inList(o.bg, SECTION_BGS) && o.bg !== "auto") out.bg = o.bg;
  if (inList(o.pad, SECTION_PADS) && o.pad !== "auto") out.pad = o.pad;
  if (inList(o.align, SECTION_ALIGNS) && o.align !== "auto") out.align = o.align;
  if (inList(o.hide, SECTION_HIDES) && o.hide !== "none") out.hide = o.hide;
  return Object.keys(out).length ? out : null;
}

/** the data attributes the renderer puts on a section (null = untouched section) */
export function sectionStyleAttrs(s: unknown): Record<string, string> | null {
  const c = cleanSectionStyle(s);
  if (!c) return null;
  const a: Record<string, string> = {};
  if (c.anim) a["data-sanim"] = c.anim;
  if (c.bg) a["data-sbg"] = c.bg;
  if (c.pad) a["data-spad"] = c.pad;
  if (c.align) a["data-salign"] = c.align;
  if (c.hide) a["data-shide"] = c.hide;
  return a;
}

/* ------------------------------------------------------------------ style packs */

export const STYLE_PACKS = ["elegant", "bold", "minimal", "playful", "corporate", "cinematic", "warm", "tech"] as const;
export type StylePack = (typeof STYLE_PACKS)[number];

/** every pack uses a font with Hebrew and Arabic letters (sites here are mostly he / ar) */
interface PackDef {
  theme: { font?: string; radius?: "sharp" | "soft" | "round"; effects?: "none" | "subtle" | "rich"; dividers?: "none" | "wave" | "curve" | "slant"; buttons: (typeof SITE_BUTTONS)[number]; hover: (typeof SITE_HOVERS)[number]; entrance: (typeof SITE_ENTRANCES)[number]; header: (typeof SITE_HEADERS)[number] };
  /** the rhythm of section backgrounds (repeats); the hero and banner are never coloured by the pack */
  rhythm: SectionBg[];
  heroAnim: SectionAnim;
  /** sections that get a stronger treatment */
  feature: { types: string[]; bg: SectionBg; anim?: SectionAnim };
}

const PACKS: Record<StylePack, PackDef> = {
  elegant: { theme: { font: "frank", radius: "sharp", effects: "subtle", dividers: "none", buttons: "outline", hover: "glow", entrance: "fade", header: "minimal" }, rhythm: ["plain", "tint"], heroAnim: "fade", feature: { types: ["testimonials", "cta"], bg: "dark", anim: "blur" } },
  bold: { theme: { font: "rubik", radius: "soft", effects: "rich", dividers: "slant", buttons: "gradient", hover: "lift", entrance: "rise", header: "solid" }, rhythm: ["plain", "accent"], heroAnim: "zoom", feature: { types: ["stats", "cta", "countdown"], bg: "gradient", anim: "zoom" } },
  minimal: { theme: { font: "heebo", radius: "soft", effects: "subtle", dividers: "none", buttons: "solid", hover: "none", entrance: "fade", header: "minimal" }, rhythm: ["plain"], heroAnim: "fade", feature: { types: ["cta"], bg: "tint" } },
  playful: { theme: { font: "varela", radius: "round", effects: "rich", dividers: "wave", buttons: "pill", hover: "tilt", entrance: "scale", header: "glass" }, rhythm: ["plain", "tint", "accent"], heroAnim: "zoom", feature: { types: ["features", "steps"], bg: "accent", anim: "flip" } },
  corporate: { theme: { font: "heebo", radius: "soft", effects: "subtle", dividers: "none", buttons: "solid", hover: "lift", entrance: "rise", header: "solid" }, rhythm: ["plain", "tint"], heroAnim: "rise", feature: { types: ["stats", "trust"], bg: "dark" } },
  cinematic: { theme: { font: "noto-serif", radius: "sharp", effects: "rich", dividers: "curve", buttons: "glass", hover: "glow", entrance: "blur", header: "glass" }, rhythm: ["plain", "dark"], heroAnim: "blur", feature: { types: ["gallery", "video", "testimonials"], bg: "dark", anim: "zoom" } },
  warm: { theme: { font: "assistant", radius: "round", effects: "subtle", dividers: "wave", buttons: "pill", hover: "lift", entrance: "rise", header: "glass" }, rhythm: ["plain", "tint"], heroAnim: "rise", feature: { types: ["about", "testimonials"], bg: "gradient" } },
  tech: { theme: { font: "rubik", radius: "soft", effects: "rich", dividers: "slant", buttons: "gradient", hover: "glow", entrance: "slide", header: "glass" }, rhythm: ["plain", "gradient"], heroAnim: "blur", feature: { types: ["features", "comparison", "stats"], bg: "dark", anim: "rise" } },
};

export function packTheme(pack: StylePack) {
  return { ...PACKS[pack].theme };
}

/**
 * Apply a pack: the site-wide design + a section rhythm. The business's content, colours and mode are kept; sections
 * the person styled by hand ("keepManual") keep their own style.
 */
export function applyStylePack<T extends { theme: Record<string, unknown>; blocks: { type: string; style?: BlockStyle | null }[] }>(site: T, pack: StylePack, opts: { keepManual?: boolean } = {}): T {
  const def = PACKS[pack];
  let n = 0;
  const blocks = site.blocks.map((b) => {
    if (opts.keepManual && cleanSectionStyle(b.style)) return b;
    if (b.type === "hero") return { ...b, style: { anim: def.heroAnim } };
    if (b.type === "banner") return { ...b, style: undefined };
    const bg: SectionBg = def.feature.types.includes(b.type) ? def.feature.bg : def.rhythm[n++ % def.rhythm.length]!;
    const style: BlockStyle = { ...(bg !== "plain" ? { bg } : {}), ...(def.feature.types.includes(b.type) && def.feature.anim ? { anim: def.feature.anim } : {}) };
    return { ...b, style: Object.keys(style).length ? style : undefined };
  });
  // never two heavy bands in a row (a rhythm band next to a featured band)
  return { ...site, theme: { ...site.theme, ...def.theme, animations: def.theme.effects === "none" ? site.theme.animations : true }, blocks: balanceRhythm(blocks) };
}

/** two dark / accent sections in a row look heavy: the second one becomes "tint" (used after AI edits and packs) */
export function balanceRhythm<T extends { style?: BlockStyle | null }>(blocks: T[]): T[] {
  let prevStrong = false;
  return blocks.map((b) => {
    const bg = b.style?.bg;
    const strong = bg === "dark" || bg === "accent";
    if (strong && prevStrong) {
      prevStrong = false;
      return { ...b, style: { ...b.style, bg: "tint" as const } };
    }
    prevStrong = strong;
    return b;
  });
}

/** the style pack that fits a template / requested style / industry (used when a new site has no section design yet) */
export function packFor(template?: string | null, style?: string | null, industry?: string | null): StylePack {
  const by: Record<string, StylePack> = {
    luxe: "elegant", editorial: "elegant", noir: "cinematic", midnight: "cinematic", bold: "bold", neon: "tech", aurora: "tech", studio: "tech",
    minimal: "minimal", pastel: "playful", fresh: "warm", sunset: "warm", terracotta: "warm", nature: "warm", ocean: "warm", corporate: "corporate", clinic: "corporate", classic: "corporate",
  };
  if (style === "luxury") return "elegant";
  if (style === "minimal") return "minimal";
  if (style === "corporate") return "corporate";
  if (style === "playful") return "playful";
  if (style === "bold") return "bold";
  if (industry === "law" || industry === "clinic" || industry === "finance") return "corporate";
  return by[String(template ?? "")] ?? "corporate";
}
