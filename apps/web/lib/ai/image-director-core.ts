/**
 * Image director (pure, unit-tested) — turns a short request ("a post about our new color treatment",
 * "hero for a dental clinic") into a professional art-direction prompt, the way a top image model expects it:
 * subject + action + setting, camera / lens / angle, lighting, color palette, mood, style, quality and strict
 * "no text" rules — and the right aspect ratio for where the picture goes.
 *
 * The prompt always starts with "<Kind>: <subject in its setting>." so the stock-photo fallbacks (which search on the
 * first sentence after the first colon — stockQuery / photoQuery) search on the real subject, never on style words.
 * Added next to buildImagePrompt / buildSceneImagePrompt (studio-core); nothing there changed.
 */

export type ImagePurpose = "post" | "hero" | "section" | "product" | "portrait" | "background" | "ad" | "story";
export type DirectorStyle = "auto" | "photo" | "cinematic" | "illustration" | "3d" | "minimal" | "flatlay" | "luxury" | "lifestyle" | "product";
export type Aspect = "1:1" | "4:5" | "9:16" | "16:9" | "3:2" | "4:3" | "21:9";

/** what the art director decided (an AI fills it; a deterministic default fills the gaps) */
export interface ImageBrief {
  /** the main subject and what happens — concrete, in English ("a hairstylist applying a glossy caramel balayage to a smiling woman") */
  subject: string;
  setting?: string;
  mood?: string;
  lighting?: string;
  palette?: string;
  composition?: string;
  camera?: string;
  style?: DirectorStyle;
  details?: string[];
}

export interface DirectInput {
  /** the person's request / the post / the site brief (any language) */
  request: string;
  purpose: ImagePurpose;
  style?: DirectorStyle | null;
  platform?: "facebook" | "instagram" | null;
  business?: string | null;
  /** brand colors (#hex) — the palette leans on them */
  brandColors?: string[];
  /** the brand voice / mood words the business saved */
  brandVoice?: string | null;
}

/* ------------------------------------------------------------------ industries: what a great picture of this business shows */

interface Industry {
  key: string;
  re: RegExp;
  scene: string;
  setting: string;
  details: string[];
}

const INDUSTRIES: Industry[] = [
  // (pets first: "a haircut for dogs" is a pet groomer, not a hair salon)
  { key: "pets", re: /(dog|cat|pet|grooming|vet|veterinar|כלב|כלבים|חתול|חיות|טיפוח כלבים|וטרינר|كلب|قطة|حيوانات)/i, scene: "a happy, freshly groomed dog with a fluffy coat looking at the camera", setting: "a clean, cheerful pet grooming studio with soft pastel tones", details: ["fluffy fur texture", "bright eyes", "playful energy"] },
  { key: "salon", re: /(hair|salon|barber|stylist|balayage|haircut|מספרה|ספר|תספורת|צבע לשיער|החלקה|ברבר|عصالون|حلاق|شعر)/i, scene: "a professional hairstylist finishing a glossy, perfectly styled haircut for a delighted client", setting: "a bright, modern boutique hair salon with warm wood, plants and soft mirrors", details: ["healthy shiny hair texture", "natural skin tones", "styling tools neatly arranged"] },
  { key: "beauty", re: /(beauty|cosmetic|nails?|manicure|lashes|brows|makeup|skin ?care|spa|קוסמטיק|ציפורניים|מניקור|ריסים|גבות|איפור|טיפוח|ספא|تجميل|أظافر|سبا)/i, scene: "a beautician performing a gentle premium treatment on a relaxed client", setting: "a serene, minimalist beauty studio with soft neutral tones and fresh flowers", details: ["flawless natural skin", "elegant glass bottles", "clean towels"] },
  { key: "restaurant", re: /(restaurant|cafe|coffee|food|dish|menu|chef|pizza|burger|sushi|bar\b|bistro|מסעדה|בית קפה|קפה|אוכל|מנה|שף|פיצה|המבורגר|סושי|ביסטרו|مطعم|مقهى|طعام|طبق)/i, scene: "a beautifully plated signature dish with fresh ingredients, steam gently rising", setting: "a warm, stylish restaurant table with soft bokeh of the dining room behind", details: ["appetizing textures and sauces", "garnish details", "rustic ceramic plate"] },
  { key: "bakery", re: /(bakery|bread|cake|pastry|dessert|cookies|מאפ|לחם|עוגה|עוגות|קינוח|עוגיות|مخبز|كعك|حلويات)/i, scene: "freshly baked artisan pastries and a cake with a perfect golden crumb", setting: "a cozy artisan bakery counter with flour dust and morning light", details: ["flaky layers", "powdered sugar", "linen and wood props"] },
  { key: "dental", re: /(dental|dentist|teeth|orthodont|smile|שיניים|רופא שיניים|יישור|אסתטיקה דנטלית|أسنان)/i, scene: "a confident patient with a bright healthy smile talking with a friendly dentist", setting: "a modern, spotless dental clinic with calm blue-white tones", details: ["natural white teeth", "modern equipment softly out of focus", "reassuring atmosphere"] },
  { key: "clinic", re: /(clinic|doctor|medical|health|physio|therapy|psycholog|nutrition|קליניקה|רופא|רפואי|פיזיותרפיה|טיפול|פסיכולוג|תזונה|עיסוי|عيادة|طبيب|علاج)/i, scene: "a caring health professional speaking warmly with a client", setting: "a calm, light-filled modern clinic with plants and soft textiles", details: ["trustworthy expressions", "clean professional environment"] },
  { key: "fitness", re: /(gym|fitness|trainer|workout|yoga|pilates|crossfit|כושר|מאמן|אימון|יוגה|פילאטיס|نادي|لياقة|يوغا)/i, scene: "an energetic athlete mid-workout with perfect form, a coach encouraging", setting: "a modern premium training studio with dramatic light and clean equipment", details: ["visible effort and motion", "defined muscles", "sweat glistening"] },
  { key: "realestate", re: /(real estate|apartment|house|home|property|villa|interior|נדל|דירה|דירות|בית|נכס|וילה|עיצוב פנים|عقار|شقة|منزل|فيلا)/i, scene: "a bright, elegantly staged living room in a luxury home", setting: "an architectural interior with floor-to-ceiling windows and a city or garden view", details: ["clean lines", "natural materials", "golden-hour light through windows"] },
  { key: "law", re: /(law|lawyer|attorney|legal|notary|accountant|tax|finance|insurance|עורך דין|עו"ד|משפט|נוטריון|רואה חשבון|מס|ביטוח|פיננס|محامي|قانون|محاسب)/i, scene: "a confident professional advising a client across a modern desk", setting: "an elegant contemporary office with books, glass and warm wood", details: ["trustworthy body language", "tidy documents", "subtle premium details"] },
  { key: "construction", re: /(construction|renovation|contractor|plumber|electrician|builder|kitchen|שיפוץ|שיפוצים|קבלן|אינסטלטור|חשמלאי|בנייה|מטבח|ترميم|مقاول|بناء)/i, scene: "a skilled craftsman completing a flawless renovation detail", setting: "a freshly renovated modern home interior with clean finishes", details: ["precise tools", "quality materials", "before-and-after pride"] },
  { key: "tech", re: /(software|saas|app|tech|digital|startup|website|marketing agency|ai\b|תוכנה|אפליקציה|הייטק|דיגיטל|סטארטאפ|אתר|שיווק דיגיטלי|برمجيات|تطبيق|تقنية)/i, scene: "a focused team collaborating around a laptop showing clean colorful dashboards", setting: "a bright modern workspace with glass, plants and soft daylight", details: ["screens with abstract UI (no readable text)", "diverse professionals", "modern devices"] },
  { key: "florist", re: /(flower|florist|bouquet|wedding|event|פרחים|זר|חתונה|אירוע|אירועים|ورد|زهور|زفاف)/i, scene: "a lush, elegant bouquet being arranged by careful hands", setting: "a romantic floral studio with soft daylight and rich textures", details: ["fresh petals with dew", "harmonious colors"] },
  { key: "fashion", re: /(fashion|clothing|boutique|jewelry|jewellery|watch|shoes|bags|אופנה|בגדים|בוטיק|תכשיט|תכשיטים|שעון|נעליים|תיק|أزياء|مجوهرات)/i, scene: "a stylish model wearing the collection in an elegant pose", setting: "a minimal editorial studio or a sunlit city street", details: ["fabric texture and drape", "accessory sparkle", "editorial styling"] },
  { key: "education", re: /(course|teacher|tutor|school|academy|workshop|lessons|קורס|מורה|שיעור|שיעורים|בית ספר|אקדמיה|סדנה|לימוד|دورة|مدرس|تعليم)/i, scene: "an engaged learner having a breakthrough moment with a supportive teacher", setting: "a bright, inspiring modern classroom or studio", details: ["genuine smiles", "notebooks and laptops"] },
  { key: "car", re: /(car|garage|auto|mechanic|vehicle|detailing|רכב|מוסך|מכונאי|ליטוש|רכבים|سيارة|ورشة)/i, scene: "a gleaming car with a flawless mirror finish after professional detailing", setting: "a clean, well-lit modern garage studio", details: ["reflections on paint", "precise tools"] },
  { key: "travel", re: /(travel|hotel|vacation|tour|zimmer|resort|טיול|מלון|נופש|צימר|חופשה|سفر|فندق|سياحة)/i, scene: "a breathtaking view of a dream destination with travelers enjoying the moment", setting: "golden-hour landscape with a boutique hotel terrace", details: ["inviting atmosphere", "vivid but natural colors"] },
  { key: "cleaning", re: /(cleaning|cleaner|house cleaning|ניקיון|ניקוי|تنظيف)/i, scene: "a spotless, sunlit home just cleaned by a friendly professional", setting: "a bright modern apartment with sparkling surfaces", details: ["gleaming surfaces", "fresh and airy feeling"] },
  { key: "photography", re: /(photograph|photographer|photo studio|video|צילום|צלם|סטודיו|וידאו|تصوير|مصور)/i, scene: "a photographer capturing a beautiful moment with a professional camera", setting: "a creative studio with dramatic light", details: ["camera gear detail", "soft rim light"] },
];

export function detectIndustry(text: string | null | undefined): Industry | null {
  const t = (text ?? "").slice(0, 2000);
  if (!t.trim()) return null;
  return INDUSTRIES.find((i) => i.re.test(t)) ?? null;
}

/* ------------------------------------------------------------------ styles, purposes, aspect ratios */

const STYLE_LOOK: Record<Exclude<DirectorStyle, "auto">, { kind: string; look: string; camera: string; lighting: string }> = {
  photo: { kind: "Professional photograph", look: "editorial commercial photography, true-to-life colors, crisp detail, premium brand campaign quality", camera: "shot on a full-frame camera, 50mm lens, f/2.0, shallow depth of field", lighting: "soft natural window light with gentle fill" },
  lifestyle: { kind: "Lifestyle photograph", look: "authentic candid lifestyle photography, genuine emotion, warm and inviting, Instagram-worthy", camera: "35mm lens, eye level, natural candid framing", lighting: "warm golden-hour daylight" },
  cinematic: { kind: "Cinematic still", look: "cinematic film still, rich color grading, depth and atmosphere, subtle film grain", camera: "anamorphic lens, low angle, dramatic depth", lighting: "dramatic directional key light with soft rim light" },
  luxury: { kind: "Luxury campaign photograph", look: "high-end luxury advertising, refined elegance, rich textures, sophisticated restraint", camera: "85mm lens, f/1.8, impeccable framing", lighting: "soft sculpted studio lighting with elegant highlights" },
  product: { kind: "Product photograph", look: "premium product photography, hero product in sharp focus, styled props, catalog-perfect", camera: "100mm macro lens, three-quarter angle", lighting: "softbox studio lighting with clean reflections" },
  illustration: { kind: "Premium illustration", look: "modern premium vector-style illustration, clean shapes, harmonious limited palette, soft gradients, editorial magazine quality", camera: "balanced flat composition", lighting: "soft even illustrated light" },
  "3d": { kind: "High-end 3D render", look: "polished 3D render, smooth materials, playful yet premium, subtle subsurface scattering", camera: "isometric three-quarter view", lighting: "soft studio lighting with gentle global illumination" },
  minimal: { kind: "Minimalist photograph", look: "minimalist composition, generous negative space, one clear subject, calm and elegant premium aesthetic", camera: "centered symmetrical framing", lighting: "soft diffused light, gentle shadows" },
  flatlay: { kind: "Flat lay photograph", look: "top-down flat lay, neatly arranged objects on a textured surface, styled like a premium lifestyle brand shoot", camera: "overhead 90-degree angle", lighting: "soft even daylight" },
};

const PURPOSE_RULES: Record<ImagePurpose, string> = {
  post: "Scroll-stopping social media image with one strong focal point and a clean, uncluttered background.",
  story: "Vertical full-bleed story image, subject in the middle third, safe empty space at top and bottom.",
  hero: "Website hero image: wide cinematic framing, the subject on one side and calm empty space on the other side for a headline overlay.",
  section: "Website section image that supports the text next to it: clear subject, calm background, consistent brand look.",
  product: "Hero product shot, the product perfectly lit and in focus, styled props that tell the story.",
  portrait: "Professional portrait, natural confident expression, flattering light, softly blurred background.",
  background: "Subtle background image with low visual noise and a lot of calm space, suitable behind text.",
  ad: "Advertising visual with a single clear message, bold composition and premium finish.",
};

export function aspectFor(purpose: ImagePurpose, platform?: "facebook" | "instagram" | null): Aspect {
  if (purpose === "story") return "9:16";
  if (purpose === "hero") return "16:9";
  if (purpose === "background") return "21:9";
  if (purpose === "section") return "4:3";
  if (purpose === "portrait") return "4:5";
  if (purpose === "product") return "1:1";
  if (platform === "instagram") return "1:1";
  return purpose === "ad" ? "1:1" : "16:9";
}

/** a style for "auto": what fits the purpose and the industry */
export function pickStyle(style: DirectorStyle | null | undefined, purpose: ImagePurpose, industry: Industry | null): Exclude<DirectorStyle, "auto"> {
  if (style && style !== "auto") return style;
  if (purpose === "product") return "product";
  if (industry && ["realestate", "fashion", "law"].includes(industry.key)) return "luxury";
  if (industry && ["restaurant", "bakery", "travel"].includes(industry.key)) return "lifestyle";
  if (industry && industry.key === "tech") return "photo";
  return purpose === "hero" ? "cinematic" : "photo";
}

const NEGATIVE =
  "Strictly no text, letters, words, numbers, logos, watermarks, captions, signs or UI labels anywhere in the image. No distorted faces, no extra fingers, no warped hands, no duplicated limbs, no blurry or low-resolution areas, no oversaturated colors, no stock-photo clichés.";
const QUALITY = "Ultra-detailed, sharp focus on the subject, realistic textures and materials, accurate anatomy, natural skin, high dynamic range, professional color grading, award-winning commercial quality.";

const clean = (s: unknown, n: number): string =>
  typeof s === "string"
    ? s
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/["“”«»]/g, "")
        .trim()
        .slice(0, n)
    : "";
const isLatin = (s: string) => !/[֐-׿؀-ۿ]/.test(s);

/** the colors of the brand as words a model understands (hex values are ignored by most image models) */
export function paletteWords(colors: string[] | undefined): string {
  const names: string[] = [];
  for (const c of (colors ?? []).slice(0, 3)) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) continue;
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    let hue = 0;
    if (max !== min) {
      if (max === r) hue = ((g - b) / (max - min)) % 6;
      else if (max === g) hue = (b - r) / (max - min) + 2;
      else hue = (r - g) / (max - min) + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const tone = l < 0.22 ? "deep" : l > 0.78 ? "soft pastel" : sat < 0.18 ? "muted" : "rich";
    const base = sat < 0.12 ? (l < 0.3 ? "charcoal" : l > 0.8 ? "warm white" : "gray") : hue < 15 || hue >= 345 ? "red" : hue < 40 ? "orange" : hue < 60 ? "golden yellow" : hue < 90 ? "olive green" : hue < 160 ? "green" : hue < 195 ? "teal" : hue < 250 ? "blue" : hue < 290 ? "violet" : "magenta";
    names.push(sat < 0.12 ? base : `${tone} ${base}`);
  }
  return [...new Set(names)].join(", ");
}

/** a deterministic brief when no AI is available (or to fill what the AI left out) */
export function defaultBrief(input: DirectInput): ImageBrief {
  const ind = detectIndustry(`${input.request} ${input.business ?? ""}`);
  const latinRequest = isLatin(input.request) ? clean(input.request, 240) : "";
  return {
    subject: latinRequest || ind?.scene || "a welcoming professional at work with a happy customer",
    setting: ind?.setting,
    details: ind?.details,
  };
}

/** merges an AI brief over the default one (AI wins where it gave a real value) */
export function mergeBrief(ai: Partial<ImageBrief> | null, base: ImageBrief): ImageBrief {
  if (!ai) return base;
  const pick = (k: keyof ImageBrief, n: number) => {
    const v = clean(ai[k], n);
    return v && isLatin(v) ? v : undefined;
  };
  return {
    subject: pick("subject", 260) ?? base.subject,
    setting: pick("setting", 200) ?? base.setting,
    mood: pick("mood", 120) ?? base.mood,
    lighting: pick("lighting", 140) ?? base.lighting,
    palette: pick("palette", 140) ?? base.palette,
    composition: pick("composition", 160) ?? base.composition,
    camera: pick("camera", 120) ?? base.camera,
    style: (["photo", "cinematic", "illustration", "3d", "minimal", "flatlay", "luxury", "lifestyle", "product"] as const).find((s) => s === ai.style) ?? base.style,
    details: Array.isArray(ai.details) ? ai.details.map((d) => clean(d, 80)).filter((d) => d && isLatin(d)).slice(0, 5) : base.details,
  };
}

/** reads the art director's JSON answer (tolerant: code fences, prose around it) */
export function parseBrief(raw: string | null | undefined): Partial<ImageBrief> | null {
  const s = String(raw ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    if (!j || typeof j !== "object") return null;
    return j as Partial<ImageBrief>;
  } catch {
    return null;
  }
}

/** the final prompt + what goes with it */
export interface DirectedImage {
  prompt: string;
  /** a short English subject (for stock-photo searches and the asset title) */
  subject: string;
  aspect: Aspect;
  style: Exclude<DirectorStyle, "auto">;
}

export function composeImagePrompt(brief: ImageBrief, input: DirectInput): DirectedImage {
  const ind = detectIndustry(`${input.request} ${input.business ?? ""}`);
  const style = pickStyle(brief.style ?? input.style, input.purpose, ind);
  const look = STYLE_LOOK[style];
  const aspect = aspectFor(input.purpose, input.platform);
  const subject = clean(brief.subject, 260) || defaultBrief(input).subject;
  const setting = clean(brief.setting, 200) || ind?.setting || "";
  const palette = clean(brief.palette, 140) || [paletteWords(input.brandColors), "harmonious, brand-consistent colors"].filter(Boolean).join(", ");
  const mood = clean(brief.mood, 120) || clean(input.brandVoice, 120) || "inviting, trustworthy and premium";
  const details = (brief.details ?? ind?.details ?? []).filter(Boolean).slice(0, 5);
  const orientation = aspect === "9:16" || aspect === "4:5" ? "vertical" : aspect === "1:1" ? "square" : "wide horizontal";
  const prompt = [
    `${look.kind}: ${subject}${setting ? `, in ${setting.replace(/^in\s+/i, "")}` : ""}.`,
    `${look.look}.`,
    `Camera: ${clean(brief.camera, 120) || look.camera}.`,
    `Lighting: ${clean(brief.lighting, 140) || look.lighting}.`,
    `Composition: ${clean(brief.composition, 160) || "rule of thirds, clear focal point, layered depth with foreground and background"}; ${orientation} ${aspect} frame.`,
    `Color palette: ${palette}.`,
    `Mood: ${mood}.`,
    details.length ? `Details: ${details.join(", ")}.` : "",
    PURPOSE_RULES[input.purpose],
    QUALITY,
    NEGATIVE,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1750);
  return { prompt, subject, aspect, style };
}

/** the art director's instructions for the text model (answer: one JSON object) */
export const ART_DIRECTOR_SYSTEM = [
  "You are a world-class art director and prompt engineer for state-of-the-art image models (Google Gemini image / Nano Banana, FLUX, Midjourney).",
  "Read the request (any language) and the business context, and design ONE outstanding, on-brief image that a top agency would deliver.",
  "Be concrete and visual: who / what is in the picture, what they are doing, where, which props, which emotion. Show the business's real service or product — never a generic stock scene unrelated to the request.",
  "Never put text, letters, numbers, prices, logos or signs in the picture.",
  'Answer with ONE JSON object only, all values in English: {"subject": "main subject + action, 10-30 words", "setting": "where, 5-20 words", "mood": "2-6 words", "lighting": "specific lighting", "palette": "3-5 color words", "composition": "framing and angle", "camera": "lens / angle", "style": "photo|lifestyle|cinematic|luxury|product|illustration|3d|minimal|flatlay", "details": ["3-5 small details that make it real"]}',
].join("\n");

export function artDirectorUser(input: DirectInput): string {
  const ind = detectIndustry(`${input.request} ${input.business ?? ""}`);
  return [
    `Request: ${clean(input.request, 1200)}`,
    input.business ? `Business: ${clean(input.business, 120)}` : "",
    ind ? `Industry: ${ind.key}` : "",
    `Where the image goes: ${input.purpose}${input.platform ? ` on ${input.platform}` : ""} (${aspectFor(input.purpose, input.platform)})`,
    input.style && input.style !== "auto" ? `Requested style: ${input.style}` : "",
    input.brandColors?.length ? `Brand colors: ${paletteWords(input.brandColors) || input.brandColors.join(", ")}` : "",
    input.brandVoice ? `Brand voice: ${clean(input.brandVoice, 160)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A seed for stock-photo searches (site galleries / sections): the site's English image prompt when it has one,
 * otherwise the industry's real scene — a Hebrew brief used to fall back to the word "business" (unrelated photos).
 */
export function stockSeed(imagePrompt: string | null | undefined, brief: string | null | undefined): string {
  const p = (imagePrompt ?? "").trim();
  if (p && /[a-z]{3,}/i.test(p) && isLatin(p)) return p;
  const ind = detectIndustry(`${p} ${brief ?? ""}`);
  if (ind) return `${ind.scene}, ${ind.setting}`;
  const latin = (brief ?? "").match(/[A-Za-z][A-Za-z -]{3,}/g)?.join(" ") ?? "";
  return latin || p || "modern small business team with happy customers";
}
