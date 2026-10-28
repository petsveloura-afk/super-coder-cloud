/**
 * Wave 37 — the edit agent's knowledge (pure, unit-tested; appended to the edit prompt AFTER the
 * overrides). It adds three things the model did not have: design principles of top-tier sites,
 * an industry playbook picked from the site's own texts, and a short list of what THIS site lacks.
 * Everything is advisory: the owner's instruction always wins, existing content is never removed.
 */
export type Industry = "clinic" | "law" | "restaurant" | "realestate" | "fitness" | "beauty" | "shop" | "agency" | "trades" | "education" | "events" | "tech";

const RULES: [Industry, RegExp][] = [
  ["clinic", /(clinic|doctor|dentist|therap|physio|medical|health|מרפא|רופא|שיניים|טיפול|פיזיו|קליניק|בריאות|عيادة|طبيب|أسنان|علاج)/i],
  ["law", /(law|lawyer|attorney|legal firm|notary|עורך דין|עורכי דין|משרד עו|נוטריון|משפט|محام|قانون)/i],
  ["restaurant", /(restaurant|cafe|café|bar\b|catering|chef|bakery|מסעד|קפה|קייטרינג|שף|מאפי|בר\b|מطعم|مقهى)/i],
  ["realestate", /(real estate|realtor|property|apartment|נדל"ן|נדלן|דירות|מתווך|נכסים|عقار|شقق)/i],
  ["fitness", /(gym|fitness|trainer|yoga|pilates|crossfit|כושר|מאמן|יוגה|פילאטיס|חדר כושר|لياقة|نادي رياضي)/i],
  ["beauty", /(beauty|salon|hair|nails|makeup|spa\b|barber|קוסמט|מספרה|שיער|ציפורניים|איפור|ספא|تجميل|صالون)/i],
  ["shop", /(shop|store|e-?commerce|fashion|jewel|boutique|חנות|אופנה|תכשיט|בוטיק|משלוח|متجر|ملابس)/i],
  ["agency", /(agency|marketing|branding|design studio|seo|סוכנות|שיווק|מיתוג|סטודיו|קופירייטינג|وكالة|تسويق)/i],
  ["trades", /(plumb|electric|contractor|renovat|locksmith|cleaning|moving|garden|אינסטלצ|חשמל|שיפוץ|קבלן|ניקיון|הובלות|מנעולן|גינון|سباك|كهرب|ترميم|تنظيف)/i],
  ["education", /(course|school|tutor|lesson|academy|training|workshop|קורס|שיעור|בית ספר|אקדמ|הדרכה|סדנ|מורה|دورة|مدرسة|تدريب)/i],
  ["events", /(wedding|event|photograph|dj\b|venue|חתונ|אירוע|צילום|צלם|אולם|הפקות|زفاف|حفلات|مصور)/i],
  ["tech", /(software|saas|app\b|platform|startup|developer|cyber|תוכנה|סטארטאפ|אפליקצי|פיתוח|פלטפורמה|برمجيات|تطبيق)/i],
];

export function detectIndustry(texts: string[]): Industry | null {
  const s = texts.join(" ").slice(0, 8000);
  let best: Industry | null = null;
  let bestN = 0;
  for (const [k, re] of RULES) {
    const n = (s.match(new RegExp(re.source, "gi")) ?? []).length;
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return bestN >= 1 ? best : null;
}

export const PLAYBOOKS: Record<Industry, string> = {
  clinic: "Clinics / therapists: calm, reassuring tone. Lead with the problem solved + credentials (use only real ones). Strong: trust badges (experience, privacy, easy booking), steps (first visit), FAQ (insurance, pain, duration — no medical promises), booking section. Template ideas: clinic, fresh.",
  law: "Law / accounting: authority and clarity. Lead with the outcome for the client, not the firm. Strong: practice areas as features, process timeline, FAQ (fees, timing, confidentiality), trust badges (free first consultation if true). Never promise results. Template ideas: corporate, editorial.",
  restaurant: "Restaurants / cafes / catering: appetite + atmosphere. Short sensory copy, gallery near the top, hours/location in contact, booking or order CTA. Strong: gallery, about (story), testimonials only if real. Template ideas: sunset, terracotta.",
  realestate: "Real estate: premium and discreet. Lead with area + specialty. Strong: gallery, about, steps (buying/selling process), comparison table (working with an agent vs. alone, honest), lead form. Template ideas: luxe, noir.",
  fitness: "Fitness / wellness: energy and transformation. Short imperative headlines, steps (start in 3 steps), pricing only if given, first-session CTA. Strong: trust badges (first class free only if true), stats only with real numbers. Template ideas: neon, bold.",
  beauty: "Beauty / salons: elegant, visual. Gallery early, services as features, booking CTA everywhere, FAQ (duration, aftercare). Template ideas: pastel, fresh, studio.",
  shop: "Shops / e-commerce: remove purchase friction. Benefits (delivery, returns, warranty) as trust badges, comparison (us vs. generic) only with honest points, countdown ONLY with a real sale end date. Template ideas: bold, pastel.",
  agency: "Agencies / freelancers: proof and process. Lead with the result delivered; logos only if real; steps/timeline for the process; comparison (us vs. DIY / typical agency) honest; strong CTA to a short call. Template ideas: studio, midnight.",
  trades: "Home services / trades: trust + speed. Phone and WhatsApp prominent, response time and service area in trust badges, free quote CTA, FAQ (pricing method, warranty, availability). Template ideas: classic, bold.",
  education: "Education / courses: outcome + path. Who it is for, what you will be able to do, timeline of the course, FAQ (prerequisites, schedule, refund), registration CTA. Template ideas: fresh, minimal.",
  events: "Events / photography / venues: emotion + portfolio. Gallery first, short story, steps (how we work), availability CTA with a date question in the form. Template ideas: noir, editorial.",
  tech: "Tech / SaaS: clarity in 5 seconds. Headline = what it does + for whom; features with outcomes, steps (get started in 3 steps), pricing only if given, comparison vs. 'doing it manually', FAQ (security, integrations). Template ideas: midnight, aurora.",
};

const PRINCIPLES = [
  "DESIGN & COPY PRINCIPLES (apply when you add or rewrite; never at the cost of the owner's facts):",
  "- Hierarchy: one clear promise in the hero (≤ 9 words), one proof point, one action. Every section answers one visitor question and ends in a natural next step.",
  "- Rhythm: alternate dense sections (features, FAQ) with light ones (stats, trust, a quote); never place three text-only sections in a row.",
  "- Mobile first: titles ≤ 6 words, paragraphs ≤ 3 lines, list items ≤ 12 words. Put the action button in the hero and again near the end.",
  "- Proof over adjectives: replace 'professional, quality, best' with specifics (what, how fast, for whom) — but only specifics found in the content; otherwise leave an owner placeholder.",
  "- Honesty: never invent numbers, reviews, prices, dates, licences, awards or client names. Comparison rows must be generic and fair; a countdown needs a real end date.",
  "- Section choice: banner = one real offer/news; trust = guarantees and reasons to believe; timeline = a process or real history; comparison = us vs. the usual alternative; countdown = a real deadline.",
].join("\n");

export interface BrainBlock {
  type: string;
  data?: Record<string, unknown>;
}

/** what this particular site lacks (hints only — the owner's instruction decides what to do) */
export function siteGaps(blocks: BrainBlock[]): string[] {
  const has = (t: string) => blocks.some((b) => b.type === t);
  const gaps: string[] = [];
  if (!has("faq")) gaps.push("no FAQ");
  if (!has("form") && !has("booking") && !has("contact")) gaps.push("no way to leave details");
  if (!has("testimonials") && !has("stats") && !has("logos") && !has("trust")) gaps.push("no social proof or trust section");
  if (!has("steps") && !has("timeline")) gaps.push("no explanation of how it works");
  if (blocks.length < 5) gaps.push("a thin page (fewer than 5 sections)");
  return gaps;
}

export function siteBrain(texts: string[], blocks: BrainBlock[]): string {
  const ind = detectIndustry(texts);
  const gaps = siteGaps(blocks);
  return [
    "SITE EXPERT KNOWLEDGE (advisory — the owner's instruction always wins; never remove existing content because of it):",
    PRINCIPLES,
    ind ? `INDUSTRY PLAYBOOK — ${PLAYBOOKS[ind]}` : "",
    gaps.length ? `WHAT THIS SITE LACKS RIGHT NOW (only act on it when the instruction is broad, e.g. 'improve' / 'make it better' / 'polish'): ${gaps.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
