import type { SiteBlock } from "@scc/shared/engagement";

/**
 * Wave 36 — a smarter site builder (pure, unit-tested).
 *
 * The AI is good at copy but loose on instructions: it forgot sections the owner asked for, added
 * ones they refused, ignored "dark / animated / luxury / blue and gold", left the hero button
 * pointing at a section that does not exist and ordered sections inconsistently. These rules:
 *   1. parseBuildDirectives  - read what the owner asked for (free text in he/ar/en + the structured
 *                              "Preferences" block the new builder chips write)
 *   2. siteBuildOverrides    - a design-director prompt that is added AFTER the shared one
 *   3. polishBuiltSite       - deterministic clean-up of the model's answer so the site ALWAYS
 *                              follows the instructions, whatever the model did
 */
export type SectionKey = "gallery" | "pricing" | "testimonials" | "faq" | "team" | "video" | "steps" | "stats" | "about" | "logos";
export type StyleKey = "luxury" | "minimal" | "warm" | "bold" | "playful" | "corporate" | "tech" | "natural" | "clean";
export type Industry = "clinic" | "law" | "food" | "realestate" | "fitness" | "beauty" | "shop" | "agency" | "trades" | "education";

export interface BuildDirectives {
  include: SectionKey[];
  exclude: SectionKey[];
  mode?: "dark" | "light";
  animations?: boolean;
  style?: StyleKey;
  accent?: string;
  accent2?: string;
  industry?: Industry;
}

export const SECTION_KEYS: SectionKey[] = ["gallery", "pricing", "testimonials", "faq", "team", "video", "steps", "stats", "about", "logos"];
export const STYLE_KEYS: StyleKey[] = ["luxury", "minimal", "warm", "bold", "playful", "corporate", "tech", "natural", "clean"];

const WORDS: Record<SectionKey, RegExp> = {
  gallery: /(gallery|portfolio|photos|גלר|תמונות|העבודות שלנו|معرض)/i,
  pricing: /(pricing|price list|prices|plans|מחיר|תמחור|חבילות|أسعار|تسعير)/i,
  testimonials: /(testimonial|reviews|המלצות|ביקורות|آراء|تقييمات)/i,
  faq: /(faq|שאלות נפוצות|أسئلة شائعة)/i,
  team: /(team|our staff|הצוות|צוות|فريق)/i,
  video: /(video|וידאו|סרטון|فيديو)/i,
  steps: /(process|how it works|steps|תהליך|שלבים|איך זה עובד|خطوات)/i,
  stats: /(stats|numbers|figures|מספרים|נתונים|إحصائيات)/i,
  about: /(about us|about|אודות|הסיפור שלנו|من نحن)/i,
  logos: /(logos|our clients|לוגואים|הלקוחות שלנו|عملاؤنا)/i,
};
const NEG = /(no|without|don't|do not|never|skip|בלי|ללא|אל תוסיף|אל תכניס|לא צריך|לא רוצה|بدون|لا )\s*[^.,;\n]{0,24}$/i;
const POS = /(with|include|including|add|also|want|need|must|עם|תוסיף|תוסיפו|הוסף|גם|רוצה|צריך|תכלול|כולל|חובה|مع|أضف|أريد|يشمل)\s*[^.,;\n]{0,24}$/i;

const COLORS: Record<string, string> = {
  blue: "#2563EB", "כחול": "#2563EB", "أزرق": "#2563EB",
  navy: "#1E3A8A", "כחולכהה": "#1E3A8A",
  green: "#16A34A", "ירוק": "#16A34A", "أخضر": "#16A34A",
  red: "#DC2626", "אדום": "#DC2626", "أحمر": "#DC2626",
  orange: "#F97316", "כתום": "#F97316", "برتقالي": "#F97316",
  purple: "#7C3AED", "סגול": "#7C3AED", "بنفسجي": "#7C3AED",
  pink: "#EC4899", "ורוד": "#EC4899", "وردي": "#EC4899",
  gold: "#C9A24D", "זהב": "#C9A24D", "ذهبي": "#C9A24D",
  turquoise: "#0EA5A5", "טורקיז": "#0EA5A5", "تركواز": "#0EA5A5",
  yellow: "#EAB308", "צהוב": "#EAB308", "أصفر": "#EAB308",
  brown: "#92400E", "חום": "#92400E", "بني": "#92400E",
};

const INDUSTRY_WORDS: Record<Industry, RegExp> = {
  clinic: /(clinic|dentist|doctor|medical|physio|therapy|מרפאה|שיניים|רופא|רפואי|פיזיותרפ|טיפול|عيادة|طبيب|أسنان)/i,
  law: /(law firm|lawyer|attorney|legal|notary|עורך דין|משרד עורכי|עורכת דין|נוטריון|محام)/i,
  food: /(restaurant|cafe|coffee|bakery|catering|chef|מסעדה|קפה|מאפייה|קייטרינג|שף|מסעדת|مطعم|مقهى)/i,
  realestate: /(real estate|realtor|property|apartments|נדל"ן|נדלן|דירות|תיווך|عقارات)/i,
  fitness: /(gym|fitness|trainer|yoga|pilates|crossfit|כושר|מאמן|יוגה|פילאטיס|חדר כושר|لياقة|مدرب)/i,
  beauty: /(salon|barber|beauty|cosmetic|spa|nails|makeup|מספרה|קוסמטיק|ספא|ציפורניים|איפור|יופי|صالون|تجميل)/i,
  shop: /(shop|store|boutique|e-?commerce|retail|חנות|בוטיק|חנות אונליין|מכירת|متجر)/i,
  agency: /(agency|marketing|branding|design studio|consult|סוכנות|שיווק|מיתוג|סטודיו לעיצוב|ייעוץ|وكالة|تسويق)/i,
  trades: /(contractor|renovation|plumber|electrician|carpent|cleaning|moving|קבלן|שיפוצים|אינסטלטור|חשמלאי|נגר|ניקיון|הובלות|مقاول|سباك)/i,
  education: /(course|school|academy|tutor|lessons|workshop|קורס|בית ספר|אקדמיה|מורה פרטי|שיעורים|סדנה|دورة|مدرسة)/i,
};

const STYLE_WORDS: Record<StyleKey, RegExp> = {
  luxury: /(luxur|premium|elegant|exclusive|יוקרתי|יוקרה|אלגנטי|פרימיום|فاخر)/i,
  minimal: /(minimal|simple|clean white|מינימליסטי|פשוט ונקי|بسيط)/i,
  warm: /(warm|cozy|friendly|family|חם|נעים|משפחתי|ידידותי|دافئ)/i,
  bold: /(bold|striking|loud|energetic|נועז|בולט|אנרגטי|جريء)/i,
  playful: /(playful|fun|colorful|kids|שובב|צבעוני|ילדים|מהנה|مرح)/i,
  corporate: /(corporate|professional|serious|formal|תאגידי|רציני|רשמי|עסקי|رسمي)/i,
  tech: /(tech|futuristic|startup|saas|טכנולוגי|עתידני|סטארטאפ|تقني)/i,
  natural: /(natural|organic|eco|green living|טבעי|אורגני|אקולוגי|طبيعي)/i,
  clean: /(fresh|clean|medical clean|רענן|נקי|מרענן|نظيف)/i,
};

const STYLE_TEMPLATES: Record<StyleKey, string[]> = {
  luxury: ["luxe", "noir", "editorial"],
  minimal: ["minimal", "studio", "editorial"],
  warm: ["terracotta", "pastel", "nature"],
  bold: ["bold", "neon", "sunset"],
  playful: ["pastel", "sunset", "bold"],
  corporate: ["corporate", "classic", "ocean"],
  tech: ["aurora", "midnight", "neon"],
  natural: ["nature", "fresh", "terracotta"],
  clean: ["clinic", "fresh", "minimal"],
};
const STYLE_RADIUS: Partial<Record<StyleKey, "sharp" | "soft" | "round">> = { luxury: "sharp", minimal: "sharp", corporate: "soft", playful: "round", warm: "round" };

const colorOf = (w: string) => COLORS[w.toLowerCase().replace(/^ה/, "").replace(/^ו(?=[^\s])/, "")] ?? COLORS[w.toLowerCase()] ?? COLORS[w.toLowerCase().replace(/^ו/, "")];

/** Read what the owner asked for: free text (he / ar / en) plus the structured "Preferences" block. */
export function parseBuildDirectives(text: string): BuildDirectives {
  const out: BuildDirectives = { include: [], exclude: [] };
  const inc = new Set<SectionKey>();
  const exc = new Set<SectionKey>();

  // 1) structured lines (written by the builder chips — reliable)
  const line = (re: RegExp) => text.match(re)?.[1]?.trim() ?? "";
  const must = line(/^\s*must include:\s*(.+)$/im);
  const mustNot = line(/^\s*must not include:\s*(.+)$/im);
  for (const k of SECTION_KEYS) {
    if (new RegExp(`\\b${k}\\b`, "i").test(must)) inc.add(k);
    if (new RegExp(`\\b${k}\\b`, "i").test(mustNot)) exc.add(k);
  }
  const style = line(/^\s*style:\s*([a-z]+)/im).toLowerCase();
  if ((STYLE_KEYS as string[]).includes(style)) out.style = style as StyleKey;
  const mode = line(/^\s*mode:\s*([a-z]+)/im).toLowerCase();
  if (mode === "dark" || mode === "light") out.mode = mode;
  const anim = line(/^\s*animations:\s*([a-z]+)/im).toLowerCase();
  if (anim === "yes") out.animations = true;
  if (anim === "no") out.animations = false;

  // 2) free text
  for (const k of SECTION_KEYS) {
    const re = new RegExp(WORDS[k].source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      if (NEG.test(before)) exc.add(k);
      else if (POS.test(before)) inc.add(k);
    }
  }
  if (!out.style) for (const k of STYLE_KEYS) if (STYLE_WORDS[k].test(text)) { out.style = k; break; }
  if (!out.mode) {
    if (/(dark (mode|theme|design)|עיצוב כהה|מצב כהה|ערכה כהה|ערכת נושא כהה|داكن)/i.test(text)) out.mode = "dark";
    else if (/(light (mode|theme|design)|עיצוב בהיר|מצב בהיר|ערכה בהירה|فاتح)/i.test(text)) out.mode = "light";
  }
  if (out.animations === undefined) {
    if (/(no animations?|without animations?|בלי אנימציות|ללא אנימציות|בלי הנפשה|بدون حركة)/i.test(text)) out.animations = false;
    else if (/(animated|animations?|motion|מונפש|אנימציות|אנימציה|הנפשה|متحرك|حركة)/i.test(text)) out.animations = true;
  }
  const cm = text.match(/(?:colou?rs?|צבעי|צבע|צבעים|لون|ألوان)\s*:?\s*(?:ה)?([^\s,.;]+)(?:\s*(?:and|,|ו|و|&)\s*(?:ה)?([^\s,.;]+))?/i);
  if (cm) {
    const a = colorOf(cm[1] ?? "");
    const b = cm[2] ? colorOf(cm[2]) : undefined;
    if (a) out.accent = a;
    if (b) out.accent2 = b;
  }
  for (const k of Object.keys(INDUSTRY_WORDS) as Industry[]) if (INDUSTRY_WORDS[k].test(text)) { out.industry = k; break; }

  out.include = [...inc].filter((k) => !exc.has(k));
  out.exclude = [...exc];
  return out;
}

const RECIPES: Record<Industry, string> = {
  clinic: "Clinic / health: hero with the main treatment + 'book a visit' button, about the practitioner(s), treatments (features), how a visit works (steps), FAQ (fear, price ranges only if given, insurance), booking / contact. Calm, trustworthy, clean.",
  law: "Law / professional: hero stating the practice areas and who you help, practice areas (features), why this firm (about), how we work (steps), FAQ, consultation CTA. Serious, precise, no hype.",
  food: "Food / hospitality: hero with the signature dish or atmosphere, menu highlights (features), the story (about), gallery, opening hours and address (contact), reservation CTA. Appetising, warm.",
  realestate: "Real estate: hero with the area and promise, services (buy / sell / rent), the process (steps), why this agent (about), FAQ, valuation / viewing CTA. Premium and confident.",
  fitness: "Fitness / training: hero with the transformation promise, programs (features), how to start (steps), the trainer (about), schedule / plans if given, free-trial CTA. Energetic.",
  beauty: "Beauty / salon: hero with the signature service, services list (features), the atmosphere (about), gallery, booking CTA. Elegant, soft.",
  shop: "Shop: hero with the main product benefit, categories (features), why buy here (shipping, returns, quality), steps to order, FAQ, contact. Clear and trustworthy.",
  agency: "Agency / consulting: hero with the outcome you create for clients, services (features), method (steps), proof (stats / logos only if given), FAQ, 'let's talk' CTA. Sharp, confident.",
  trades: "Trades / home services: hero with the service + service area + 'free quote' button, services (features), how it works (steps), why us (guarantee, speed, clean work), FAQ, quote CTA + phone prominent.",
  education: "Education / courses: hero with the learning outcome, what you will learn (features), the path (steps), the teacher (about), FAQ, enrol CTA.",
};

/** The design-director rules, appended AFTER the shared builder prompt (they override it where they conflict). */
export function siteBuildOverrides(d: BuildDirectives, mode: "landing" | "full"): string {
  const lines = [
    "SENIOR DESIGN-DIRECTOR RULES - these OVERRIDE anything above that conflicts with them:",
    "- Work like a senior brand designer and conversion copywriter (Wix / Framer quality), not a template filler. Every section must earn its place.",
    "- Mobile-first copy: section titles up to 60 characters, hero subtitle up to 140, feature / step texts up to 120. Short sentences, one idea each.",
    "- Hero: an outcome-focused headline (what the customer GETS), a subtitle with the proof or the specific audience / city when given, ONE primary button. Never 'Welcome to ...'.",
    "- Every section title is specific and different (no repeated 'Our services'); use varied section types - features, steps, about, faq, cta - so the page feels designed, not a list.",
    `- Set \"animations\": ${d.animations === false ? "false" : "true"}. Pick the template, font and radius that fit the tone (luxury = sharp corners + elegant serif; playful = round corners).`,
    "- Hero button and every cta href must point to a section that exists on the page (#contact, #form, #faq).",
    "- NEVER invent phone numbers, e-mails, addresses, prices, reviews, client names or statistics.",
    mode === "full" ? "- Full site: 8-14 sections with a clear story arc: promise -> proof -> offer -> process -> answers -> action." : "- Landing page: 5-8 sections, one goal, one repeated call to action.",
  ];
  if (d.industry) lines.push(`- Detected business type - follow this recipe: ${RECIPES[d.industry]}`);
  if (d.style) lines.push(`- The owner asked for a ${d.style} look: prefer these templates in this order: ${STYLE_TEMPLATES[d.style].join(", ")}.`);
  if (d.mode) lines.push(`- The owner asked for ${d.mode} mode: set \"mode\": \"${d.mode}\".`);
  if (d.accent) lines.push(`- The owner named brand colours: use accent ${d.accent}${d.accent2 ? ` and accent2 ${d.accent2}` : ""}.`);
  if (d.include.length)
    lines.push(
      `- The owner EXPLICITLY asked for these sections - they MUST appear: ${d.include.join(", ")}. When the customer gave no real data for one (testimonials, pricing, stats, team, gallery), still add it with 2-3 clearly-labelled placeholder rows in the site's language that the owner can replace - never skip it.`,
    );
  if (d.exclude.length) lines.push(`- The owner does NOT want these sections: ${d.exclude.join(", ")}. Do not add them.`);
  return lines.join("\n");
}

type B = { type: string; data: Record<string, unknown> };
export interface PolishableSite {
  name: string;
  theme: { accent: string; mode: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: "sharp" | "soft" | "round"; animations?: boolean };
  seo: { title: string; description: string };
  blocks: SiteBlock[];
}

const PLACEHOLDERS: Record<"he" | "ar" | "en", Record<string, () => B>> = {
  he: {
    testimonials: () => ({ type: "testimonials", data: { title: "מה הלקוחות אומרים", items: [{ name: "שם הלקוח", role: "תפקיד / עיר", quote: "כאן מוסיפים המלצה אמיתית מלקוח מרוצה", rating: "5" }] } }),
    pricing: () => ({ type: "pricing", data: { title: "מחירים וחבילות", items: [{ name: "שם החבילה", price: "", period: "", features: "מה כלול בחבילה", highlight: "", cta_label: "לפרטים", cta_href: "#contact" }] } }),
    stats: () => ({ type: "stats", data: { title: "במספרים", items: [{ value: "0", label: "מוסיפים כאן נתון אמיתי" }, { value: "0", label: "מוסיפים כאן נתון אמיתי" }] } }),
    team: () => ({ type: "team", data: { title: "הצוות שלנו", items: [{ name: "שם איש צוות", role: "תפקיד", image_url: "" }] } }),
    faq: () => ({ type: "faq", data: { title: "שאלות נפוצות", items: [{ q: "מוסיפים כאן שאלה נפוצה", a: "מוסיפים כאן את התשובה" }] } }),
    steps: () => ({ type: "steps", data: { title: "איך זה עובד", items: [{ title: "שלב ראשון", text: "מתארים כאן את השלב" }, { title: "שלב שני", text: "מתארים כאן את השלב" }] } }),
    about: () => ({ type: "about", data: { title: "קצת עלינו", body: "מספרים כאן את הסיפור של העסק, הניסיון והערכים.", image_url: "" } }),
    logos: () => ({ type: "logos", data: { title: "עובדים איתנו", items: [{ name: "שם לקוח" }] } }),
    gallery: () => ({ type: "gallery", data: { title: "הגלריה שלנו", items: [] } }),
  },
  ar: {
    testimonials: () => ({ type: "testimonials", data: { title: "ماذا يقول عملاؤنا", items: [{ name: "اسم العميل", role: "الوظيفة / المدينة", quote: "أضيفوا هنا رأيًا حقيقيًا من عميل راضٍ", rating: "5" }] } }),
    pricing: () => ({ type: "pricing", data: { title: "الأسعار والباقات", items: [{ name: "اسم الباقة", price: "", period: "", features: "ما تشمله الباقة", highlight: "", cta_label: "للتفاصيل", cta_href: "#contact" }] } }),
    stats: () => ({ type: "stats", data: { title: "بالأرقام", items: [{ value: "0", label: "أضيفوا رقمًا حقيقيًا هنا" }, { value: "0", label: "أضيفوا رقمًا حقيقيًا هنا" }] } }),
    team: () => ({ type: "team", data: { title: "فريقنا", items: [{ name: "اسم عضو الفريق", role: "المنصب", image_url: "" }] } }),
    faq: () => ({ type: "faq", data: { title: "أسئلة شائعة", items: [{ q: "أضيفوا سؤالًا شائعًا هنا", a: "أضيفوا الإجابة هنا" }] } }),
    steps: () => ({ type: "steps", data: { title: "كيف نعمل", items: [{ title: "الخطوة الأولى", text: "صفوا الخطوة هنا" }, { title: "الخطوة الثانية", text: "صفوا الخطوة هنا" }] } }),
    about: () => ({ type: "about", data: { title: "من نحن", body: "احكوا هنا قصة العمل والخبرة والقيم.", image_url: "" } }),
    logos: () => ({ type: "logos", data: { title: "يعملون معنا", items: [{ name: "اسم العميل" }] } }),
    gallery: () => ({ type: "gallery", data: { title: "معرضنا", items: [] } }),
  },
  en: {
    testimonials: () => ({ type: "testimonials", data: { title: "What customers say", items: [{ name: "Customer name", role: "Role / city", quote: "Add a real testimonial from a happy customer here", rating: "5" }] } }),
    pricing: () => ({ type: "pricing", data: { title: "Pricing and plans", items: [{ name: "Plan name", price: "", period: "", features: "What is included", highlight: "", cta_label: "Get details", cta_href: "#contact" }] } }),
    stats: () => ({ type: "stats", data: { title: "In numbers", items: [{ value: "0", label: "Add a real number here" }, { value: "0", label: "Add a real number here" }] } }),
    team: () => ({ type: "team", data: { title: "Our team", items: [{ name: "Team member", role: "Role", image_url: "" }] } }),
    faq: () => ({ type: "faq", data: { title: "Frequently asked questions", items: [{ q: "Add a common question here", a: "Add the answer here" }] } }),
    steps: () => ({ type: "steps", data: { title: "How it works", items: [{ title: "Step one", text: "Describe the step here" }, { title: "Step two", text: "Describe the step here" }] } }),
    about: () => ({ type: "about", data: { title: "About us", body: "Tell the story of the business, its experience and values here.", image_url: "" } }),
    logos: () => ({ type: "logos", data: { title: "Trusted by", items: [{ name: "Client name" }] } }),
    gallery: () => ({ type: "gallery", data: { title: "Our gallery", items: [] } }),
  },
};
const HERO_CTA = { he: "בואו נדבר", ar: "لنتحدث", en: "Get in touch" } as const;
const TAIL: string[] = ["faq", "cta", "booking", "form", "contact"];

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "").trim() || s.slice(0, max));

export interface PolishResult<T extends PolishableSite> {
  site: T;
  applied: string[];
}

/**
 * Make the model's site follow the owner's instructions and a consistent professional structure.
 * `templates` = the templates the plan allows (a style never forces a locked one).
 */
export function polishBuiltSite<T extends PolishableSite>(input: T, d: BuildDirectives, o: { locale: "he" | "ar" | "en"; templates: readonly string[]; maxBlocks: number; template?: string }): PolishResult<T> {
  const applied: string[] = [];
  const site = { ...input, theme: { ...input.theme }, seo: { ...input.seo }, blocks: [...input.blocks] } as T;
  let blocks = site.blocks as unknown as B[];

  // 1) excluded sections out (never the hero / contact)
  const before = blocks.length;
  blocks = blocks.filter((b) => !(d.exclude as string[]).includes(b.type));
  if (blocks.length !== before) applied.push("exclude");

  // 2) requested sections that are missing are added (clearly-labelled placeholders, never invented facts)
  for (const k of d.include) {
    if (blocks.some((b) => b.type === k)) continue;
    const make = PLACEHOLDERS[o.locale][k];
    if (!make) continue;
    const nb = make();
    const at = blocks.findIndex((b) => TAIL.includes(b.type));
    blocks.splice(at < 0 ? blocks.length : at, 0, nb);
    applied.push(`add:${k}`);
  }

  // 3) consistent order: hero first; faq, cta, booking, form, contact at the end in that order
  const hero = blocks.filter((b) => b.type === "hero").slice(0, 1);
  const tail = TAIL.flatMap((t) => blocks.filter((b) => b.type === t));
  const head = blocks.filter((b) => b.type !== "hero" && !TAIL.includes(b.type));
  const ordered = [...hero, ...head, ...tail];
  if (ordered.some((b, i) => b !== blocks[i])) applied.push("order");
  blocks = ordered.slice(0, Math.max(o.maxBlocks, d.include.length ? o.maxBlocks + 3 : o.maxBlocks));

  // 4) buttons point at sections that exist
  const idx = (t: string) => blocks.findIndex((b) => b.type === t);
  const target = idx("contact") >= 0 ? "#contact" : idx("form") >= 0 ? "#form" : idx("booking") >= 0 ? `#s${idx("booking")}` : idx("faq") >= 0 ? "#faq" : "";
  for (const b of blocks) {
    const key = b.type === "hero" ? "cta_href" : b.type === "cta" ? "href" : "";
    if (!key || !target) continue;
    const cur = String(b.data[key] ?? "");
    const missing = (cur === "#contact" && idx("contact") < 0) || (cur === "#form" && idx("form") < 0) || (cur === "#faq" && idx("faq") < 0) || cur === "";
    if (missing) {
      b.data = { ...b.data, [key]: target };
      applied.push("link");
    }
  }
  const h = blocks[0];
  if (h?.type === "hero" && !String(h.data.cta_label ?? "").trim()) {
    h.data = { ...h.data, cta_label: HERO_CTA[o.locale] };
    applied.push("cta-label");
  }

  // 5) look: explicit instructions win, then the plan's allowed templates
  if (d.mode) site.theme.mode = d.mode;
  if (d.accent) site.theme.accent = d.accent;
  if (d.accent2) site.theme.accent2 = d.accent2;
  site.theme.animations = d.animations === false ? false : true;
  if (!o.template && d.style) {
    const pick = STYLE_TEMPLATES[d.style].find((k) => o.templates.includes(k));
    if (pick) {
      site.theme.template = pick;
      applied.push(`template:${pick}`);
    }
    const r = STYLE_RADIUS[d.style];
    if (r && !site.theme.radius) site.theme.radius = r;
  }

  // 6) search-engine texts that fit
  site.seo.title = clip(site.seo.title, 60);
  site.seo.description = clip(site.seo.description, 155);

  site.blocks = blocks as unknown as T["blocks"];
  return { site, applied };
}
