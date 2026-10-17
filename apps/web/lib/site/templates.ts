import type { SITE_FONTS, SITE_TEMPLATE_KEYS } from "@scc/shared/engagement";

/**
 * Wave 13 — website design templates. Pure data (used by the public renderer, the
 * builder's gallery and the AI). Each template is a full visual system — not just a
 * colour: palette, type pairing, hero layout, card treatment, background and motion.
 * Free plans get the first three; the rest are part of paid plans (site_pro_templates).
 */
export type TemplateKey = (typeof SITE_TEMPLATE_KEYS)[number];
export type FontKey = (typeof SITE_FONTS)[number];

export interface SiteTemplate {
  key: TemplateKey;
  pro: boolean;
  mode: "dark" | "light";
  /** default brand colours (the business can change both) */
  accent: string;
  accent2: string;
  palette: { bg: string; fg: string; muted: string; card: string; line: string; soft: string };
  display: FontKey;
  body: FontKey;
  radius: "sharp" | "soft" | "round";
  /** split = text + art side by side · centered = big type in the middle · cover = full-bleed image · stacked = type then a wide image */
  hero: "split" | "centered" | "cover" | "stacked";
  /** card treatment for item grids */
  cards: "solid" | "glass" | "line" | "brutal" | "lifted";
  /** page background treatment */
  bg: "glow" | "aurora" | "grid" | "plain" | "blobs" | "rules" | "dots";
  /** how sections enter on scroll */
  motion: "rise" | "fade" | "scale" | "slide" | "none";
  he: { name: string; desc: string; fits: string };
  en: { name: string; desc: string; fits: string };
}

export const FONTS: Record<FontKey, { family: string; google: string; fallback: string }> = {
  rubik: { family: "Rubik", google: "Rubik:wght@400;500;700;800", fallback: "system-ui, sans-serif" },
  heebo: { family: "Heebo", google: "Heebo:wght@300;400;500;700;800", fallback: "system-ui, sans-serif" },
  assistant: { family: "Assistant", google: "Assistant:wght@300;400;600;800", fallback: "system-ui, sans-serif" },
  frank: { family: "Frank Ruhl Libre", google: "Frank+Ruhl+Libre:wght@400;500;700;900", fallback: "Georgia, serif" },
  inter: { family: "Inter", google: "Inter:wght@400;500;700;800", fallback: "system-ui, sans-serif" },
  playfair: { family: "Playfair Display", google: "Playfair+Display:wght@500;700;800", fallback: "Georgia, serif" },
  secular: { family: "Secular One", google: "Secular+One", fallback: "system-ui, sans-serif" },
  varela: { family: "Varela Round", google: "Varela+Round", fallback: "system-ui, sans-serif" },
  suez: { family: "Suez One", google: "Suez+One", fallback: "Georgia, serif" },
  karantina: { family: "Karantina", google: "Karantina:wght@400;700", fallback: "system-ui, sans-serif" },
  "noto-serif": { family: "Noto Serif Hebrew", google: "Noto+Serif+Hebrew:wght@400;600;800", fallback: "Georgia, serif" },
};

export const TEMPLATES: SiteTemplate[] = [
  {
    key: "classic",
    pro: false,
    mode: "dark",
    accent: "#3366E6",
    accent2: "#22C3EE",
    palette: { bg: "#0b1020", fg: "#e8ecf5", muted: "#9aa4b8", card: "#121a2e", line: "#24304a", soft: "#16203a" },
    display: "rubik",
    body: "rubik",
    radius: "soft",
    hero: "split",
    cards: "solid",
    bg: "glow",
    motion: "rise",
    he: { name: "קלאסי", desc: "כהה ונקי, תמונה לצד הכותרת", fits: "כל עסק" },
    en: { name: "Classic", desc: "Dark and clean, image beside the headline", fits: "Any business" },
  },
  {
    key: "minimal",
    pro: false,
    mode: "light",
    accent: "#1F2A44",
    accent2: "#E4572E",
    palette: { bg: "#F6F7F9", fg: "#14161A", muted: "#5B6170", card: "#FFFFFF", line: "#DADDE3", soft: "#ECEEF2" },
    display: "heebo",
    body: "heebo",
    radius: "sharp",
    hero: "centered",
    cards: "line",
    bg: "rules",
    motion: "fade",
    he: { name: "מינימליסטי", desc: "טיפוגרפיה גדולה, קווים דקים, הרבה אוויר", fits: "יועצים, משרדים, סטודיו" },
    en: { name: "Minimal", desc: "Large type, hairlines, lots of air", fits: "Consultants, offices, studios" },
  },
  {
    key: "fresh",
    pro: false,
    mode: "light",
    accent: "#0E9F8E",
    accent2: "#FFB547",
    palette: { bg: "#FFFFFF", fg: "#10302C", muted: "#4E6B66", card: "#F1FAF8", line: "#D5EDE8", soft: "#E6F6F3" },
    display: "assistant",
    body: "assistant",
    radius: "round",
    hero: "split",
    cards: "solid",
    bg: "blobs",
    motion: "rise",
    he: { name: "רענן", desc: "בהיר ומזמין, צורות רכות", fits: "קליניקות, טיפוח, שירותים" },
    en: { name: "Fresh", desc: "Bright and welcoming, soft shapes", fits: "Clinics, beauty, services" },
  },
  {
    key: "aurora",
    pro: true,
    mode: "dark",
    accent: "#7C5CFF",
    accent2: "#22D3EE",
    palette: { bg: "#070B24", fg: "#EEF0FF", muted: "#A3A9D6", card: "rgba(255,255,255,0.06)", line: "rgba(255,255,255,0.12)", soft: "#11173A" },
    display: "heebo",
    body: "heebo",
    radius: "round",
    hero: "centered",
    cards: "glass",
    bg: "aurora",
    motion: "scale",
    he: { name: "זוהר", desc: "רקע זוהר בתנועה, כרטיסי זכוכית", fits: "טכנולוגיה, סטארטאפים, אפליקציות" },
    en: { name: "Aurora", desc: "Moving glow background, glass cards", fits: "Tech, startups, apps" },
  },
  {
    key: "luxe",
    pro: true,
    mode: "dark",
    accent: "#C8A96A",
    accent2: "#E9DCC0",
    palette: { bg: "#0F1A17", fg: "#F2EEE5", muted: "#A9B3AC", card: "#15231F", line: "#2A3B35", soft: "#132019" },
    display: "frank",
    body: "assistant",
    radius: "sharp",
    hero: "cover",
    cards: "line",
    bg: "plain",
    motion: "fade",
    he: { name: "יוקרה", desc: "סריף אלגנטי, זהב על ירוק עמוק, תמונה במסך מלא", fits: "נדל״ן, מסעדות שף, אירועים, תכשיטים" },
    en: { name: "Luxe", desc: "Elegant serif, gold on deep green, full-screen photo", fits: "Real estate, fine dining, events, jewellery" },
  },
  {
    key: "bold",
    pro: true,
    mode: "light",
    accent: "#FF3D57",
    accent2: "#1B1BFF",
    palette: { bg: "#FFFFFF", fg: "#0A0A23", muted: "#43435E", card: "#FFFFFF", line: "#0A0A23", soft: "#FFF1F3" },
    display: "secular",
    body: "rubik",
    radius: "soft",
    hero: "stacked",
    cards: "brutal",
    bg: "dots",
    motion: "slide",
    he: { name: "נועז", desc: "כותרות ענק, מסגרות עבות וצללים מוסטים", fits: "חנויות, אירועים, מותגים צעירים" },
    en: { name: "Bold", desc: "Huge headlines, thick frames, offset shadows", fits: "Shops, events, young brands" },
  },
  {
    key: "corporate",
    pro: true,
    mode: "light",
    accent: "#0B3D91",
    accent2: "#1FA2FF",
    palette: { bg: "#F4F7FB", fg: "#0B1B33", muted: "#4C5D78", card: "#FFFFFF", line: "#D9E2EF", soft: "#E8EEF7" },
    display: "heebo",
    body: "heebo",
    radius: "soft",
    hero: "split",
    cards: "lifted",
    bg: "grid",
    motion: "rise",
    he: { name: "עסקי", desc: "מסודר ואמין, מספרים בולטים", fits: "עו״ד, רו״ח, ביטוח, B2B" },
    en: { name: "Corporate", desc: "Orderly and trustworthy, standout numbers", fits: "Law, accounting, insurance, B2B" },
  },
  {
    key: "pastel",
    pro: true,
    mode: "light",
    accent: "#9B5DE5",
    accent2: "#FF8FB1",
    palette: { bg: "#FFF8FC", fg: "#2D1B3D", muted: "#6E5A7E", card: "#FFFFFF", line: "#F0DDF0", soft: "#F8ECF8" },
    display: "varela",
    body: "assistant",
    radius: "round",
    hero: "split",
    cards: "solid",
    bg: "blobs",
    motion: "scale",
    he: { name: "פסטל", desc: "רך ושמח, פינות עגולות", fits: "ילדים, קונדיטוריות, יופי, סדנאות" },
    en: { name: "Pastel", desc: "Soft and cheerful, round corners", fits: "Kids, bakeries, beauty, workshops" },
  },
  {
    key: "neon",
    pro: true,
    mode: "dark",
    accent: "#FF2E97",
    accent2: "#00E5FF",
    palette: { bg: "#0D0221", fg: "#F5EFFF", muted: "#B6A8D6", card: "#160632", line: "#3A1F66", soft: "#1B0940" },
    display: "rubik",
    body: "rubik",
    radius: "soft",
    hero: "centered",
    cards: "glass",
    bg: "grid",
    motion: "scale",
    he: { name: "ניאון", desc: "זוהר ניאון על רשת, אנרגיה של לילה", fits: "ברים, מוזיקה, גיימינג, כושר" },
    en: { name: "Neon", desc: "Neon glow on a grid, night energy", fits: "Bars, music, gaming, fitness" },
  },
  {
    key: "nature",
    pro: true,
    mode: "light",
    accent: "#2F6B3F",
    accent2: "#C98B4B",
    palette: { bg: "#F1F5EE", fg: "#1D2B1F", muted: "#566656", card: "#FFFFFF", line: "#D6E0D0", soft: "#E5EDE0" },
    display: "suez",
    body: "assistant",
    radius: "round",
    hero: "stacked",
    cards: "lifted",
    bg: "blobs",
    motion: "rise",
    he: { name: "טבע", desc: "גוונים אדמתיים וצורות אורגניות", fits: "צמחונות, יוגה, חקלאות, מוצרים טבעיים" },
    en: { name: "Nature", desc: "Earthy tones and organic shapes", fits: "Plant-based, yoga, farms, natural products" },
  },
];

export function templateByKey(key: string | null | undefined): SiteTemplate {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0]!;
}

export const FREE_TEMPLATES = TEMPLATES.filter((t) => !t.pro).map((t) => t.key);

/** Google Fonts stylesheet URL for a template's fonts (null when nothing to load). */
export function fontsHref(keys: FontKey[]): string | null {
  const uniq = [...new Set(keys)].map((k) => FONTS[k]?.google).filter(Boolean);
  return uniq.length ? `https://fonts.googleapis.com/css2?${uniq.map((g) => `family=${g}`).join("&")}&display=swap` : null;
}

const hex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
/** "#RRGGBB" + alpha (00-ff) → "#RRGGBBAA" (for soft tints of the brand colour). */
export function withAlpha(color: string, a: number): string {
  if (!hex(color)) return color;
  return `${color}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/** Readable text colour on top of a brand colour (WCAG relative luminance). */
export function onColor(color: string): "#ffffff" | "#0b0b14" {
  if (!hex(color)) return "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#0b0b14" : "#ffffff";
}

/** Resolved design tokens for a site (template defaults + the business's choices). */
export interface ResolvedTheme {
  tpl: SiteTemplate;
  accent: string;
  accent2: string;
  mode: "dark" | "light";
  display: FontKey;
  body: FontKey;
  radius: SiteTemplate["radius"];
  animations: boolean;
  palette: SiteTemplate["palette"];
}

export function resolveTheme(theme: { template?: string; accent?: string; accent2?: string; mode?: "dark" | "light"; font?: string; radius?: string; animations?: boolean } | null | undefined): ResolvedTheme {
  const tpl = templateByKey(theme?.template);
  const accent = hex(theme?.accent ?? "") ? theme!.accent! : tpl.accent;
  const accent2 = hex(theme?.accent2 ?? "") ? theme!.accent2! : tpl.accent2;
  const mode = theme?.mode === "light" || theme?.mode === "dark" ? theme.mode : tpl.mode;
  // a template designed for one mode, switched to the other, gets a matching neutral palette
  const palette =
    mode === tpl.mode
      ? tpl.palette
      : mode === "dark"
        ? { bg: "#0b1020", fg: "#e8ecf5", muted: "#9aa4b8", card: "#121a2e", line: "#24304a", soft: "#16203a" }
        : { bg: "#ffffff", fg: "#0f172a", muted: "#475569", card: "#f5f7fb", line: "#e2e8f0", soft: "#eef2f8" };
  const font = theme?.font && theme.font in FONTS ? (theme.font as FontKey) : null;
  const radius = theme?.radius === "sharp" || theme?.radius === "soft" || theme?.radius === "round" ? theme.radius : tpl.radius;
  return { tpl, accent, accent2, mode, display: font ?? tpl.display, body: font ?? tpl.body, radius, animations: theme?.animations !== false && tpl.motion !== "none", palette };
}
