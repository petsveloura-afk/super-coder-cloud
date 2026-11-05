/**
 * Campaign playbooks — ready, professional starting points (what big e-mail / messaging platforms offer on "new campaign"):
 * the goal, the best channel, a fitting audience and a written message in Hebrew, English and Arabic.
 * Rules: only the two safe merge variables ({{contact.first_name}}, {{org.name}}); details the business must supply stay
 * as [square-bracket placeholders] — the editor warns until they are filled, so nothing invented is ever sent.
 */
import type { Channel } from "./brain";

export type PlaybookId = "welcome" | "winback" | "flash" | "holiday" | "event" | "review" | "reactivate" | "launch" | "reminder" | "vip";
export type PlaybookLocale = "he" | "en" | "ar";

export interface Playbook {
  id: PlaybookId;
  channel: Channel;
  /** a fitting audience (same filters as the editor; consent rules always apply on top) */
  audience: Record<string, string | number | string[]>;
  /** best-practice send window, shown on the card */
  when: "morning" | "noon" | "evening" | "any";
  text: Record<PlaybookLocale, { name: string; subject: string; body: string }>;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "welcome",
    channel: "email",
    audience: { status: "lead", active_days: 14 },
    when: "morning",
    text: {
      he: { name: "ברוכים הבאים ללקוחות חדשים", subject: "{{contact.first_name}}, ברוכים הבאים ל{{org.name}} 👋", body: "היי {{contact.first_name}},\n\nשמחים שהצטרפת אלינו!\nב{{org.name}} אנחנו [מה העסק עושה במשפט אחד].\n\nכדי להתחיל ברגל ימין:\n• [הטבה / צעד ראשון]\n• [מה כדאי לדעת עלינו]\n\nיש שאלה? פשוט השיבו למייל הזה — אנחנו כאן.\n\nצוות {{org.name}}" },
      en: { name: "Welcome new customers", subject: "{{contact.first_name}}, welcome to {{org.name}} 👋", body: "Hi {{contact.first_name}},\n\nSo glad you joined us!\nAt {{org.name}} we [what the business does, in one sentence].\n\nTo get started:\n• [perk / first step]\n• [what to know about us]\n\nQuestions? Just reply to this email — we're here.\n\nThe {{org.name}} team" },
      ar: { name: "ترحيب بالعملاء الجدد", subject: "{{contact.first_name}}، أهلًا بك في {{org.name}} 👋", body: "مرحبًا {{contact.first_name}}،\n\nسعداء بانضمامك إلينا!\nفي {{org.name}} نحن [ماذا يقدم العمل بجملة واحدة].\n\nللبداية:\n• [ميزة / خطوة أولى]\n• [ما يجب معرفته عنا]\n\nلديك سؤال؟ فقط رد على هذه الرسالة — نحن هنا.\n\nفريق {{org.name}}" },
    },
  },
  {
    id: "winback",
    channel: "whatsapp",
    audience: { status: "customer", inactive_days: 60 },
    when: "evening",
    text: {
      he: { name: "החזרת לקוחות שלא חזרו", subject: "", body: "היי {{contact.first_name}} 😊\nמזמן לא התראינו ב{{org.name}} — התגעגענו!\nהכנו לך [הטבת חזרה] עד [תאריך].\nרוצה שנשמור לך מקום? פשוט תשיבו להודעה." },
      en: { name: "Win back past customers", subject: "", body: "Hi {{contact.first_name}} 😊\nIt's been a while at {{org.name}} — we miss you!\nWe saved you [comeback perk] until [date].\nWant us to hold a spot for you? Just reply to this message." },
      ar: { name: "استعادة العملاء الغائبين", subject: "", body: "مرحبًا {{contact.first_name}} 😊\nمرّ وقت منذ زيارتك لـ{{org.name}} — اشتقنا إليك!\nجهزنا لك [ميزة العودة] حتى [التاريخ].\nتريد أن نحجز لك؟ فقط رد على هذه الرسالة." },
    },
  },
  {
    id: "flash",
    channel: "sms",
    audience: { status: "customer" },
    when: "noon",
    text: {
      he: { name: "מבצע בזק (24 שעות)", subject: "", body: "{{contact.first_name}}, רק היום ב{{org.name}}: [ההטבה]. בתוקף עד [שעה]. לפרטים: [קישור/טלפון]. להסרה השיבו הסר" },
      en: { name: "Flash sale (24 hours)", subject: "", body: "{{contact.first_name}}, today only at {{org.name}}: [the offer]. Ends [time]. Details: [link/phone]. Reply STOP to opt out" },
      ar: { name: "عرض خاطف (24 ساعة)", subject: "", body: "{{contact.first_name}}، اليوم فقط في {{org.name}}: [العرض]. ينتهي [الساعة]. التفاصيل: [رابط/هاتف]. للإلغاء رد إلغاء" },
    },
  },
  {
    id: "holiday",
    channel: "email",
    audience: { status: "customer" },
    when: "morning",
    text: {
      he: { name: "ברכת חג + הטבה", subject: "חג שמח מ{{org.name}} 🎉 ומתנה קטנה בפנים", body: "היי {{contact.first_name}},\n\nלקראת [שם החג] רצינו לומר תודה שאתם איתנו.\n\n🎁 לכבוד החג: [ההטבה]\n📅 בתוקף עד: [תאריך]\n\n[קריאה לפעולה — למשל: קבעו תור / הזמינו עכשיו]\n\nחג שמח,\n{{org.name}}" },
      en: { name: "Holiday greeting + offer", subject: "Happy holidays from {{org.name}} 🎉 a small gift inside", body: "Hi {{contact.first_name}},\n\nAhead of [holiday] we wanted to say thank you for being with us.\n\n🎁 Holiday offer: [the offer]\n📅 Valid until: [date]\n\n[Call to action — e.g. book / order now]\n\nHappy holidays,\n{{org.name}}" },
      ar: { name: "تهنئة بالعيد + عرض", subject: "كل عام وأنتم بخير من {{org.name}} 🎉 وهدية صغيرة", body: "مرحبًا {{contact.first_name}}،\n\nبمناسبة [اسم العيد] أردنا أن نشكرك على وجودك معنا.\n\n🎁 عرض العيد: [العرض]\n📅 ساري حتى: [التاريخ]\n\n[دعوة لإجراء — مثلًا: احجز / اطلب الآن]\n\nكل عام وأنتم بخير،\n{{org.name}}" },
    },
  },
  {
    id: "event",
    channel: "whatsapp",
    audience: {},
    when: "evening",
    text: {
      he: { name: "הזמנה לאירוע / סדנה", subject: "", body: "היי {{contact.first_name}}! 🎟️\nאנחנו מזמינים אותך ל[שם האירוע] ב{{org.name}}.\n🗓 [תאריך ושעה]\n📍 [מקום]\nהמקומות מוגבלים — להרשמה השיבו \"אני בא/ה\"." },
      en: { name: "Event / workshop invite", subject: "", body: "Hi {{contact.first_name}}! 🎟️\nYou're invited to [event name] at {{org.name}}.\n🗓 [date and time]\n📍 [place]\nSeats are limited — reply \"I'm in\" to register." },
      ar: { name: "دعوة لفعالية / ورشة", subject: "", body: "مرحبًا {{contact.first_name}}! 🎟️\nندعوك إلى [اسم الفعالية] في {{org.name}}.\n🗓 [التاريخ والوقت]\n📍 [المكان]\nالأماكن محدودة — للتسجيل رد \"سأحضر\"." },
    },
  },
  {
    id: "review",
    channel: "whatsapp",
    audience: { status: "customer", active_days: 14 },
    when: "evening",
    text: {
      he: { name: "בקשת ביקורת מלקוחות מרוצים", subject: "", body: "היי {{contact.first_name}}, תודה שבחרת ב{{org.name}} 🙏\nנשמח מאוד אם תקדיש/י דקה לכתוב לנו ביקורת — זה עוזר לנו המון:\n[קישור לביקורת בגוגל]\nתודה!" },
      en: { name: "Ask happy customers for a review", subject: "", body: "Hi {{contact.first_name}}, thank you for choosing {{org.name}} 🙏\nWe'd love it if you took a minute to leave us a review — it helps us a lot:\n[Google review link]\nThank you!" },
      ar: { name: "طلب تقييم من العملاء الراضين", subject: "", body: "مرحبًا {{contact.first_name}}، شكرًا لاختيارك {{org.name}} 🙏\nيسعدنا أن تخصص دقيقة لكتابة تقييم — هذا يساعدنا كثيرًا:\n[رابط تقييم جوجل]\nشكرًا!" },
    },
  },
  {
    id: "reactivate",
    channel: "email",
    audience: { status: "lead", inactive_days: 30 },
    when: "morning",
    text: {
      he: { name: "חימום לידים שהתקררו", subject: "{{contact.first_name}}, עדיין מחפש/ת [הפתרון]?", body: "היי {{contact.first_name}},\n\nלפני זמן מה התעניינת ב[השירות / המוצר].\nרצינו לבדוק אם עוד אפשר לעזור.\n\nמה לקוחות אומרים עלינו: \"[ציטוט אמיתי של לקוח]\"\n\nרוצה שנחזור אליך לשיחה קצרה? השיבו \"כן\" ונתאם.\n\n{{org.name}}" },
      en: { name: "Re-engage cold leads", subject: "{{contact.first_name}}, still looking for [the solution]?", body: "Hi {{contact.first_name}},\n\nA while ago you asked about [the service / product].\nWe wanted to check whether we can still help.\n\nWhat customers say: \"[a real customer quote]\"\n\nWant a quick call? Reply \"yes\" and we'll set it up.\n\n{{org.name}}" },
      ar: { name: "إعادة تنشيط العملاء المحتملين", subject: "{{contact.first_name}}، هل ما زلت تبحث عن [الحل]؟", body: "مرحبًا {{contact.first_name}}،\n\nقبل فترة استفسرت عن [الخدمة / المنتج].\nأردنا أن نعرف إن كان بإمكاننا المساعدة.\n\nما يقوله عملاؤنا: \"[اقتباس حقيقي من عميل]\"\n\nتريد مكالمة قصيرة؟ رد \"نعم\" وسننسق.\n\n{{org.name}}" },
    },
  },
  {
    id: "launch",
    channel: "email",
    audience: {},
    when: "morning",
    text: {
      he: { name: "השקת מוצר / שירות חדש", subject: "חדש ב{{org.name}}: [שם החידוש] ✨", body: "היי {{contact.first_name}},\n\nיש לנו משהו חדש שחיכינו לספר עליו: [שם החידוש].\n\nלמה זה מעולה בשבילך:\n• [יתרון 1]\n• [יתרון 2]\n• [יתרון 3]\n\nלקוחות קיימים מקבלים [הטבת השקה] עד [תאריך].\n\n[קריאה לפעולה]\n\n{{org.name}}" },
      en: { name: "New product / service launch", subject: "New at {{org.name}}: [the new thing] ✨", body: "Hi {{contact.first_name}},\n\nWe have something new we couldn't wait to share: [the new thing].\n\nWhy you'll love it:\n• [benefit 1]\n• [benefit 2]\n• [benefit 3]\n\nExisting customers get [launch perk] until [date].\n\n[Call to action]\n\n{{org.name}}" },
      ar: { name: "إطلاق منتج / خدمة جديدة", subject: "جديد في {{org.name}}: [الجديد] ✨", body: "مرحبًا {{contact.first_name}}،\n\nلدينا شيء جديد ننتظر إخبارك به: [الجديد].\n\nلماذا ستحبه:\n• [ميزة 1]\n• [ميزة 2]\n• [ميزة 3]\n\nالعملاء الحاليون يحصلون على [عرض الإطلاق] حتى [التاريخ].\n\n[دعوة لإجراء]\n\n{{org.name}}" },
    },
  },
  {
    id: "reminder",
    channel: "sms",
    audience: { status: "customer" },
    when: "morning",
    text: {
      he: { name: "תזכורת (תור / חידוש / תשלום)", subject: "", body: "היי {{contact.first_name}}, תזכורת ידידותית מ{{org.name}}: [מה להזכיר] ב[תאריך]. לשינוי או שאלה: [טלפון]. להסרה השיבו הסר" },
      en: { name: "Reminder (appointment / renewal)", subject: "", body: "Hi {{contact.first_name}}, a friendly reminder from {{org.name}}: [what] on [date]. To change or ask: [phone]. Reply STOP to opt out" },
      ar: { name: "تذكير (موعد / تجديد)", subject: "", body: "مرحبًا {{contact.first_name}}، تذكير ودي من {{org.name}}: [ماذا] في [التاريخ]. للتغيير أو السؤال: [هاتف]. للإلغاء رد إلغاء" },
    },
  },
  {
    id: "vip",
    channel: "whatsapp",
    audience: { status: "customer", min_score: 70 },
    when: "evening",
    text: {
      he: { name: "הטבה בלעדית ללקוחות VIP", subject: "", body: "{{contact.first_name}}, את/ה מהלקוחות הכי יקרים לנו ב{{org.name}} 💎\nלכן לפני כולם: [ההטבה הבלעדית].\nרק לרשימה מצומצמת, עד [תאריך].\nרוצה לממש? תשיבו \"אני בפנים\"." },
      en: { name: "Exclusive VIP offer", subject: "", body: "{{contact.first_name}}, you're one of our most valued customers at {{org.name}} 💎\nSo before anyone else: [the exclusive perk].\nFor a short list only, until [date].\nWant it? Reply \"I'm in\"." },
      ar: { name: "عرض حصري لعملاء VIP", subject: "", body: "{{contact.first_name}}، أنت من أغلى عملائنا في {{org.name}} 💎\nلذلك قبل الجميع: [الميزة الحصرية].\nلقائمة محدودة فقط، حتى [التاريخ].\nتريدها؟ رد \"أنا معكم\"." },
    },
  },
];

export const PLAYBOOK_IDS = PLAYBOOKS.map((p) => p.id);

export function playbook(id: string | null | undefined): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

/** the editor's starting value for a playbook (the channel falls back to email when the suggested one is not connected) */
export function playbookValue(p: Playbook, locale: string, ready: Record<string, boolean> = {}): { name: string; channel: Channel; subject: string; body: string; audience: Record<string, unknown> } {
  const l: PlaybookLocale = locale === "en" || locale === "ar" ? locale : "he";
  const txt = p.text[l];
  const channel: Channel = ready[p.channel] === false && ready.email ? "email" : p.channel;
  const subject = channel === "email" ? txt.subject || txt.name : "";
  return { name: txt.name, channel, subject, body: txt.body, audience: { ...p.audience } };
}

/** the [placeholders] still waiting to be filled (a message is never sent with them by mistake) */
export function unfilledPlaceholders(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of String(t ?? "").matchAll(/\[([^\[\]\n]{2,60})\]/g)) out.add(m[1]!.trim());
  return [...out];
}
