import type { SiteBlock } from "@scc/shared/engagement";

/**
 * Wave 27 — industry starter kits: a ready, well-ordered set of sections (with a
 * recommended design) the owner can ADD to an existing site in one click, then edit.
 * Pure data, schema-valid, no invented phone numbers, prices, reviews or addresses.
 */
export const KIT_KEYS = ["restaurant", "clinic", "law", "fitness", "beauty", "agency"] as const;
export type KitKey = (typeof KIT_KEYS)[number];
type Lang = "he" | "en";

export interface StarterKit {
  key: KitKey;
  template: string;
  accent: string;
  accent2: string;
  name: Record<Lang, string>;
  fits: Record<Lang, string>;
}

export const STARTER_KITS: StarterKit[] = [
  { key: "restaurant", template: "sunset", accent: "#F2542D", accent2: "#F7B32B", name: { he: "מסעדה / בית קפה", en: "Restaurant / cafe" }, fits: { he: "תפריט, אווירה, הזמנת מקום", en: "Menu, atmosphere, reservations" } },
  { key: "clinic", template: "clinic", accent: "#2A8C82", accent2: "#6C8EAD", name: { he: "קליניקה / טיפולים", en: "Clinic / therapy" }, fits: { he: "אמון, תהליך, קביעת תור", en: "Trust, process, booking" } },
  { key: "law", template: "corporate", accent: "#0B3D91", accent2: "#1FA2FF", name: { he: "עו״ד / רו״ח / יועץ", en: "Law / accounting / consulting" }, fits: { he: "תחומי עיסוק, ניסיון, פנייה", en: "Practice areas, experience, enquiry" } },
  { key: "fitness", template: "neon", accent: "#FF2E97", accent2: "#00E5FF", name: { he: "כושר / סטודיו", en: "Fitness / studio" }, fits: { he: "שיעורים, מסלולים, הצטרפות", en: "Classes, plans, joining" } },
  { key: "beauty", template: "pastel", accent: "#9B5DE5", accent2: "#FF8FB1", name: { he: "יופי וטיפוח", en: "Beauty & care" }, fits: { he: "טיפולים, גלריה, תורים", en: "Treatments, gallery, appointments" } },
  { key: "agency", template: "studio", accent: "#111827", accent2: "#7C3AED", name: { he: "סוכנות / פרילנסר", en: "Agency / freelancer" }, fits: { he: "שירותים, תהליך, שיתוף פעולה", en: "Services, process, working together" } },
];

const T: Record<KitKey, Record<Lang, { hero: [string, string, string]; features: [string, [string, string][]]; about: [string, string]; steps: [string, [string, string][]]; faq: [string, [string, string][]]; cta: [string, string, string] }>> = {
  restaurant: {
    he: { hero: ["טעם שחוזרים אליו", "מנות טריות מחומרי גלם איכותיים, באווירה שמרגישים בה בבית.", "להזמנת מקום"], features: ["מה מחכה לכם", [["תפריט עונתי", "מנות שמתחדשות לפי מה שטרי בשוק."], ["אירועים וקבוצות", "ארוחות לימי הולדת, חברות ומשפחות."], ["משלוחים ואיסוף", "נהנים מהמטבח גם בבית."]]], about: ["הסיפור שלנו", "מטבח שנולד מאהבה לאוכל טוב ולאנשים. ספרו כאן מי אתם, מאיפה הגיע הרעיון ומה מייחד את המקום."], steps: ["איך זה עובד", [["בוחרים", "מעיינים בתפריט ובוחרים מנות."], ["מזמינים", "שומרים מקום או מזמינים משלוח."], ["נהנים", "מגיעים, יושבים ונהנים."]]], faq: ["שאלות נפוצות", [["צריך להזמין מקום מראש?", "מומלץ, במיוחד בערבי סוף שבוע."], ["יש אפשרויות לצמחונים וטבעונים?", "כן, ראו בתפריט את המנות המסומנות."]]], cta: ["מוכנים לארוחה הבאה?", "שמרו שולחן עוד היום.", "להזמנת מקום"] },
    en: { hero: ["A taste worth coming back for", "Fresh dishes from quality ingredients, in a place that feels like home.", "Book a table"], features: ["What awaits you", [["Seasonal menu", "Dishes that change with what is fresh at the market."], ["Events and groups", "Birthdays, team dinners and family meals."], ["Delivery and pickup", "Enjoy our kitchen at home."]]], about: ["Our story", "A kitchen born from love of good food and good people. Tell guests who you are, where the idea came from and what makes the place special."], steps: ["How it works", [["Choose", "Browse the menu and pick your dishes."], ["Order", "Reserve a table or order delivery."], ["Enjoy", "Arrive, sit down and enjoy."]]], faq: ["Good to know", [["Do I need to book ahead?", "We recommend it, especially on weekend evenings."], ["Are there vegetarian and vegan options?", "Yes, look for the marked dishes on the menu."]]], cta: ["Ready for your next meal?", "Save your table today.", "Book a table"] },
  },
  clinic: {
    he: { hero: ["טיפול מקצועי, יחס אישי", "מקום רגוע שבו מקשיבים לכם ובונים יחד תוכנית שמתאימה לכם.", "לקביעת תור"], features: ["במה אנחנו עוזרים", [["אבחון מקיף", "מתחילים בהבנה מלאה של המצב."], ["תוכנית אישית", "טיפול שמותאם אליכם ולמטרות שלכם."], ["ליווי לאורך הדרך", "זמינות לשאלות גם בין הפגישות."]]], about: ["על הקליניקה", "ספרו על ההכשרה, הניסיון והגישה הטיפולית שלכם. אנשים רוצים להכיר את מי שמטפל בהם."], steps: ["איך מתחילים", [["יוצרים קשר", "משאירים פרטים או קובעים תור אונליין."], ["פגישה ראשונה", "הכרות, אבחון והגדרת מטרות."], ["טיפול והמשך", "מתקדמים לפי התוכנית שנבנתה."]]], faq: ["שאלות נפוצות", [["כמה זמן נמשכת פגישה?", "פגישה רגילה נמשכת בדרך כלל כשעה."], ["אפשר לבטל תור?", "כן, בהודעה מראש כפי שמפורט בתנאי השירות."]]], cta: ["הצעד הראשון קטן", "קבעו תור ונדבר.", "לקביעת תור"] },
    en: { hero: ["Professional care, personal attention", "A calm place where we listen and build a plan that fits you.", "Book an appointment"], features: ["How we help", [["Thorough assessment", "We start with a full understanding of your situation."], ["Personal plan", "Treatment tailored to you and your goals."], ["Support along the way", "Available for questions between sessions."]]], about: ["About the clinic", "Share your training, experience and approach. People want to know who will be treating them."], steps: ["How to start", [["Get in touch", "Leave your details or book online."], ["First session", "Introduction, assessment and goals."], ["Treatment and follow-up", "Progress along the plan we built."]]], faq: ["Good to know", [["How long is a session?", "A regular session usually lasts about an hour."], ["Can I cancel?", "Yes, with advance notice as set out in the terms."]]], cta: ["The first step is a small one", "Book an appointment and let's talk.", "Book an appointment"] },
  },
  law: {
    he: { hero: ["ייעוץ מקצועי שאפשר לסמוך עליו", "ליווי צמוד, שפה ברורה ותוצאות — בכל שלב של התהליך.", "לשיחת ייעוץ"], features: ["תחומי העיסוק", [["תחום ראשון", "תארו במשפט אחד במה אתם מסייעים בתחום הזה."], ["תחום שני", "תארו במשפט אחד במה אתם מסייעים בתחום הזה."], ["תחום שלישי", "תארו במשפט אחד במה אתם מסייעים בתחום הזה."]]], about: ["מי אנחנו", "ספרו על הניסיון, ההכשרה והערכים שמנחים את העבודה שלכם מול לקוחות."], steps: ["איך עובדים איתנו", [["שיחה ראשונית", "מבינים את הצורך והמטרה."], ["הצעה ברורה", "תוכנית עבודה ועלויות שקופות."], ["ליווי וביצוע", "מתקדמים ומעדכנים בכל שלב."]]], faq: ["שאלות נפוצות", [["האם שיחת ההיכרות מחייבת?", "לא, היא נועדה להבין אם נוכל לעזור."], ["כמה זמן לוקח תהליך?", "תלוי בעניין; נציג הערכה בשיחה הראשונה."]]], cta: ["יש לכם שאלה? נשמח לעזור", "השאירו פרטים ונחזור אליכם.", "לשיחת ייעוץ"] },
    en: { hero: ["Professional advice you can rely on", "Close support, clear language and results — at every stage.", "Book a consultation"], features: ["Practice areas", [["First area", "Describe in one sentence how you help in this area."], ["Second area", "Describe in one sentence how you help in this area."], ["Third area", "Describe in one sentence how you help in this area."]]], about: ["Who we are", "Share your experience, training and the values that guide your work with clients."], steps: ["How we work", [["Initial call", "We understand the need and the goal."], ["Clear proposal", "A work plan and transparent costs."], ["Support and delivery", "We move forward and keep you updated."]]], faq: ["Good to know", [["Is the intro call binding?", "No, it is to see whether we can help."], ["How long does a process take?", "It depends; we give an estimate on the first call."]]], cta: ["Have a question? We're glad to help", "Leave your details and we'll get back to you.", "Book a consultation"] },
  },
  fitness: {
    he: { hero: ["מתחילים לזוז. נשארים להתחזק", "אימונים לכל רמה, מאמנים שדוחפים קדימה וקהילה שמחזיקה.", "לאימון ניסיון"], features: ["מה אצלנו", [["שיעורים קבוצתיים", "מגוון שיעורים לאורך כל היום."], ["אימון אישי", "תוכנית שנבנית סביב המטרה שלכם."], ["קהילה", "מתאמנים יחד ומתקדמים יחד."]]], about: ["הסיפור שלנו", "ספרו מי המאמנים, מה הגישה שלכם ולמי המקום מתאים."], steps: ["איך מצטרפים", [["אימון ניסיון", "מגיעים, מכירים ומרגישים."], ["בוחרים מסלול", "מנוי או כרטיסייה לפי הקצב שלכם."], ["מתחילים", "והתוצאות מגיעות."]]], faq: ["שאלות נפוצות", [["אני מתחיל/ה, זה מתאים?", "בהחלט, יש התאמה לכל רמה."], ["צריך ציוד?", "מספיק בגדי ספורט ובקבוק מים."]]], cta: ["האימון הראשון עלינו", "שריינו מקום והתחילו השבוע.", "לאימון ניסיון"] },
    en: { hero: ["Start moving. Keep getting stronger", "Workouts for every level, coaches who push you forward and a community that holds you up.", "Book a trial class"], features: ["What we offer", [["Group classes", "A range of classes throughout the day."], ["Personal training", "A plan built around your goal."], ["Community", "Train together and progress together."]]], about: ["Our story", "Tell people who the coaches are, what your approach is and who the place suits."], steps: ["How to join", [["Trial class", "Come, meet us and feel it."], ["Pick a plan", "A membership or class pass at your pace."], ["Get going", "And the results follow."]]], faq: ["Good to know", [["I'm a beginner — is it for me?", "Absolutely, every level is catered for."], ["Do I need equipment?", "Sportswear and a water bottle are enough."]]], cta: ["Your first class is on us", "Save a spot and start this week.", "Book a trial class"] },
  },
  beauty: {
    he: { hero: ["יופי שמרגישים בו טוב", "טיפולים מותאמים אישית, חומרים איכותיים ויחס שמרגיש כמו פינוק.", "לקביעת תור"], features: ["הטיפולים שלנו", [["טיפולי פנים", "התאמה לסוג העור ולמטרה."], ["שיער וסטיילינג", "גזרה, צבע ועיצוב."], ["טיפוח וציפורניים", "תוצאה מוקפדת שמחזיקה."]]], about: ["הסיפור שלנו", "ספרו על הניסיון, ההכשרה והחומרים שבהם אתם עובדים."], steps: ["איך זה עובד", [["בוחרים טיפול", "מתייעצים ובוחרים מה מתאים."], ["קובעים תור", "אונליין, בכמה לחיצות."], ["מתפנקים", "ויוצאים עם חיוך."]]], faq: ["שאלות נפוצות", [["כמה זמן נמשך טיפול?", "תלוי בסוג הטיפול; מפורט בעת קביעת התור."], ["אפשר לבטל או לדחות?", "כן, בהודעה מראש."]]], cta: ["הגיע הזמן לפינוק", "קבעו תור עוד היום.", "לקביעת תור"] },
    en: { hero: ["Beauty that feels good", "Personalised treatments, quality products and care that feels like a treat.", "Book an appointment"], features: ["Our treatments", [["Facials", "Matched to your skin type and goal."], ["Hair and styling", "Cut, colour and finish."], ["Care and nails", "A careful result that lasts."]]], about: ["Our story", "Share your experience, training and the products you work with."], steps: ["How it works", [["Choose a treatment", "Get advice and pick what suits you."], ["Book", "Online, in a few taps."], ["Relax", "And leave smiling."]]], faq: ["Good to know", [["How long is a treatment?", "It depends on the treatment; it's shown when you book."], ["Can I cancel or reschedule?", "Yes, with advance notice."]]], cta: ["Time to treat yourself", "Book an appointment today.", "Book an appointment"] },
  },
  agency: {
    he: { hero: ["יוצרים דברים שעובדים", "אסטרטגיה, עיצוב ופיתוח במקום אחד — מהרעיון ועד התוצאה.", "בואו נדבר"], features: ["מה אנחנו עושים", [["אסטרטגיה ומיתוג", "מגדירים מי אתם ומה מייחד אתכם."], ["עיצוב ופיתוח", "אתרים ומוצרים שנראים טוב ועובדים מהר."], ["צמיחה ושיווק", "מביאים את האנשים הנכונים."]]], about: ["מי אנחנו", "ספרו על הצוות, על סוגי הפרויקטים ועל הדרך שבה אתם עובדים."], steps: ["איך עובדים יחד", [["היכרות", "מבינים את העסק והמטרה."], ["תכנון ויצירה", "בונים ומעדכנים בקצב קבוע."], ["השקה ושיפור", "משיקים ומודדים ומשפרים."]]], faq: ["שאלות נפוצות", [["כמה עולה פרויקט?", "תלוי בהיקף; נעביר הצעה אחרי שיחת היכרות."], ["כמה זמן לוקח?", "נגדיר לוח זמנים ברור בתחילת העבודה."]]], cta: ["יש לכם רעיון?", "ספרו לנו ונחזור עם כיוון.", "בואו נדבר"] },
    en: { hero: ["We make things that work", "Strategy, design and development in one place — from idea to result.", "Let's talk"], features: ["What we do", [["Strategy and branding", "Defining who you are and what sets you apart."], ["Design and development", "Sites and products that look good and run fast."], ["Growth and marketing", "Bringing the right people in."]]], about: ["Who we are", "Tell people about the team, the kinds of projects you take and how you work."], steps: ["How we work together", [["Intro", "We understand the business and the goal."], ["Plan and build", "We build and update at a steady rhythm."], ["Launch and improve", "We launch, measure and refine."]]], faq: ["Good to know", [["How much does a project cost?", "It depends on scope; we send a quote after an intro call."], ["How long does it take?", "We set a clear timeline at the start."]]], cta: ["Got an idea?", "Tell us and we'll come back with a direction.", "Let's talk"] },
  },
};

/** The kit's sections for a language (Arabic falls back to English). Never includes contact details. */
export function kitBlocks(key: KitKey, locale: string): SiteBlock[] {
  const t = T[key][locale === "he" ? "he" : "en"];
  const items = (list: [string, string][]) => list.map(([title, text]) => ({ title, text }));
  return [
    { type: "hero", data: { title: t.hero[0], subtitle: t.hero[1], cta_label: t.hero[2], cta_href: "#contact", image_url: "" } },
    { type: "features", data: { title: t.features[0], items: items(t.features[1]) } },
    { type: "about", data: { title: t.about[0], body: t.about[1], image_url: "" } },
    { type: "steps", data: { title: t.steps[0], items: items(t.steps[1]) } },
    { type: "faq", data: { title: t.faq[0], items: t.faq[1].map(([q, a]) => ({ q, a })) } },
    { type: "cta", data: { title: t.cta[0], text: t.cta[1], label: t.cta[2], href: "#contact" } },
    { type: "contact", data: { title: locale === "he" ? "יצירת קשר" : "Get in touch", phone: "", whatsapp: "", email: "", address: "" } },
  ] as SiteBlock[];
}

export const kitByKey = (key: string) => STARTER_KITS.find((k) => k.key === key);
