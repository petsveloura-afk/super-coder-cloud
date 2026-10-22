/**
 * Industry templates — a ready conversation setup per business category
 * (script, details to collect, menu buttons and a pricing-policy example).
 * The business loads one in the conversation setup page and edits it freely.
 */
export interface IndustryTemplate {
  key: string;
  emoji: string;
  goal: "lead" | "booking" | "sale" | "support";
  he: { name: string; flow: string[]; fields: string[]; menu: string[]; pricing: string };
  en: { name: string; flow: string[]; fields: string[]; menu: string[]; pricing: string };
}

export const INDUSTRIES: IndustryTemplate[] = [
  {
    key: "beauty",
    emoji: "💇",
    goal: "booking",
    he: {
      name: "מספרה / קוסמטיקה / ציפורניים",
      flow: ["לברך ולשאול איזה טיפול מעניין", "להבין את הצורך (אורך שיער, סוג טיפול, אירוע מיוחד)", "לתת מחיר ומשך טיפול", "להציע מועד פנוי בשעות הפעילות", "לבקש שם וטלפון לאישור התור", "לסכם תור ולהזכיר הגעה בזמן"],
      fields: ["סוג הטיפול", "תאריך ושעה מועדפים", "אירוע מיוחד?"],
      menu: ["💇 טיפולים ומחירים", "📅 קביעת תור", "🖼️ עבודות שלנו", "📍 איך מגיעים"],
      pricing: "תספורת נשים 180 ₪, גברים 90 ₪, צבע מ-250 ₪.\nמותר לתת עד 10% הנחה בחבילה של 2 טיפולים.\nאין הנחות בימי שישי.",
    },
    en: {
      name: "Salon / beauty / nails",
      flow: ["Greet and ask which treatment", "Understand the need (hair length, treatment type, special event)", "Give price and duration", "Offer a free slot within opening hours", "Ask for name + phone to confirm", "Summarise the appointment"],
      fields: ["Treatment", "Preferred date & time", "Special event?"],
      menu: ["💇 Treatments & prices", "📅 Book", "🖼️ Our work", "📍 Location"],
      pricing: "Women's cut $50, men's $25, colour from $70.\nUp to 10% off for a 2-treatment package.",
    },
  },
  {
    key: "clinic",
    emoji: "🩺",
    goal: "booking",
    he: {
      name: "קליניקה / מטפלים / רפואה משלימה",
      flow: ["לברך ולשאול במה אפשר לעזור", "להבין בקצרה את הצורך (בלי אבחנה רפואית)", "להסביר את סוגי הטיפול והמחיר", "להציע מועד פנוי", "לבקש שם, טלפון וגיל", "לאשר ולשלוח הנחיות הגעה"],
      fields: ["סיבת הפנייה", "פעם ראשונה?", "מועד מועדף"],
      menu: ["🩺 טיפולים", "📅 קביעת תור", "💰 מחירים", "📍 כתובת"],
      pricing: "פגישת היכרות 250 ₪, טיפול 350 ₪.\nכרטיסייה של 5 טיפולים ב-1,500 ₪.\nאין הנחות נוספות.",
    },
    en: {
      name: "Clinic / therapist",
      flow: ["Greet and ask how to help", "Briefly understand the need (no medical diagnosis)", "Explain treatments and price", "Offer a free slot", "Ask for name, phone and age", "Confirm and send directions"],
      fields: ["Reason", "First visit?", "Preferred time"],
      menu: ["🩺 Treatments", "📅 Book", "💰 Prices", "📍 Address"],
      pricing: "Intro session $70, treatment $95.\n5-session card $400.",
    },
  },
  {
    key: "restaurant",
    emoji: "🍽️",
    goal: "booking",
    he: {
      name: "מסעדה / בית קפה / משלוחים",
      flow: ["לברך ולשאול: הזמנת שולחן, משלוח או תפריט?", "שולחן: כמה סועדים, תאריך ושעה", "משלוח: מה מזמינים וכתובת", "לציין זמני משלוח ומינימום הזמנה", "לבקש שם וטלפון", "לאשר את ההזמנה"],
      fields: ["מספר סועדים / פריטים", "תאריך ושעה", "כתובת למשלוח", "רגישויות למזון"],
      menu: ["📖 תפריט", "🪑 הזמנת שולחן", "🛵 משלוח", "⏰ שעות פתיחה"],
      pricing: "מינימום משלוח 80 ₪, דמי משלוח 15 ₪.\nקינוח מתנה בהזמנה מעל 250 ₪.",
    },
    en: {
      name: "Restaurant / café / delivery",
      flow: ["Greet: table, delivery or menu?", "Table: party size, date & time", "Delivery: items and address", "Mention delivery times and minimum", "Ask for name + phone", "Confirm the order"],
      fields: ["Guests / items", "Date & time", "Delivery address", "Allergies"],
      menu: ["📖 Menu", "🪑 Book a table", "🛵 Delivery", "⏰ Hours"],
      pricing: "Minimum delivery $25, delivery fee $4.",
    },
  },
  {
    key: "realestate",
    emoji: "🏠",
    goal: "lead",
    he: {
      name: "נדל״ן / תיווך",
      flow: ["לברך ולשאול: קנייה, מכירה או השכרה?", "אזור, מספר חדרים ותקציב", "מועד כניסה ודחיפות", "להציע 1–2 נכסים מתאימים או פגישה", "לבקש שם וטלפון", "לקבוע סיור או שיחה עם סוכן"],
      fields: ["קנייה/השכרה/מכירה", "אזור", "חדרים", "תקציב", "מועד כניסה"],
      menu: ["🏠 נכסים", "📅 קביעת סיור", "💬 הערכת שווי", "📞 שיחה עם סוכן"],
      pricing: "דמי תיווך 2% + מע״מ במכירה, חודש שכירות בהשכרה.\nאין הנחות בעמלה בלי אישור הסוכן.",
    },
    en: {
      name: "Real estate",
      flow: ["Greet: buy, sell or rent?", "Area, rooms and budget", "Move-in date and urgency", "Suggest 1–2 matching properties or a meeting", "Ask for name + phone", "Book a viewing or a call"],
      fields: ["Buy/rent/sell", "Area", "Rooms", "Budget", "Move-in"],
      menu: ["🏠 Listings", "📅 Book a viewing", "💬 Valuation", "📞 Talk to an agent"],
      pricing: "Commission 2% on sales, one month's rent for rentals.",
    },
  },
  {
    key: "store",
    emoji: "🛍️",
    goal: "sale",
    he: {
      name: "חנות / מסחר אונליין",
      flow: ["לברך ולשאול מה מחפשים", "לברר מידה/צבע/כמות ותקציב", "להמליץ על 1–2 מוצרים עם יתרונות", "לשלוח תמונה או קישור למוצר", "לטפל בהתנגדות מחיר לפי המדיניות", "לסגור: שם, טלפון וכתובת למשלוח"],
      fields: ["מוצר", "מידה/צבע", "כמות", "כתובת למשלוח"],
      menu: ["🛍️ מוצרים", "🔥 מבצעים", "🚚 משלוחים", "↩️ החזרות"],
      pricing: "משלוח חינם מעל 300 ₪.\nקופון 10% להזמנה ראשונה בלבד.\nאין הנחה על מוצרים במבצע.",
    },
    en: {
      name: "Store / e-commerce",
      flow: ["Greet and ask what they look for", "Size/colour/quantity and budget", "Recommend 1–2 products", "Send a photo or product link", "Handle price objections within the policy", "Close: name, phone and shipping address"],
      fields: ["Product", "Size/colour", "Quantity", "Shipping address"],
      menu: ["🛍️ Products", "🔥 Deals", "🚚 Shipping", "↩️ Returns"],
      pricing: "Free shipping over $80.\n10% coupon on the first order only.",
    },
  },
  {
    key: "services",
    emoji: "🔧",
    goal: "lead",
    he: {
      name: "בעלי מקצוע / שירותי בית",
      flow: ["לברך ולשאול מה התקלה או העבודה", "לבקש פרטים ותמונה של המקום", "עיר וזמינות", "לתת הערכת מחיר או טווח", "לבקש שם וטלפון", "לקבוע ביקור טכנאי בשעות הפעילות"],
      fields: ["סוג העבודה", "עיר", "דחיפות", "מועד מועדף"],
      menu: ["🔧 שירותים", "💰 הצעת מחיר", "📅 תיאום ביקור", "🚨 דחוף"],
      pricing: "ביקור טכנאי 250 ₪ (מקוזז מהעבודה).\nעבודה דחופה באותו יום +30%.",
    },
    en: {
      name: "Home services / trades",
      flow: ["Greet and ask what the job is", "Ask for details and a photo", "City and availability", "Give a price estimate or range", "Ask for name + phone", "Book a visit within opening hours"],
      fields: ["Job type", "City", "Urgency", "Preferred time"],
      menu: ["🔧 Services", "💰 Quote", "📅 Book a visit", "🚨 Urgent"],
      pricing: "Visit $70 (deducted from the job). Same-day +30%.",
    },
  },
  {
    key: "education",
    emoji: "🎓",
    goal: "lead",
    he: {
      name: "קורסים / שיעורים פרטיים",
      flow: ["לברך ולשאול מה רוצים ללמוד", "רמה נוכחית ומטרה", "להציע מסלול מתאים ומחיר", "לציין מועד פתיחה/שיעור ניסיון", "לבקש שם וטלפון", "להרשים ולקבוע שיחת ייעוץ או שיעור ניסיון"],
      fields: ["נושא", "רמה", "מטרה", "זמינות"],
      menu: ["🎓 קורסים", "🆓 שיעור ניסיון", "💰 מחירים", "📅 מועדי פתיחה"],
      pricing: "שיעור פרטי 150 ₪, חבילת 10 שיעורים 1,300 ₪.\nשיעור ניסיון חינם.",
    },
    en: {
      name: "Courses / tutoring",
      flow: ["Greet and ask what they want to learn", "Current level and goal", "Suggest a track and price", "Mention start date / trial lesson", "Ask for name + phone", "Book a consultation or trial"],
      fields: ["Subject", "Level", "Goal", "Availability"],
      menu: ["🎓 Courses", "🆓 Trial lesson", "💰 Prices", "📅 Start dates"],
      pricing: "Private lesson $40, 10-pack $350. Free trial.",
    },
  },
  {
    key: "fitness",
    emoji: "🏋️",
    goal: "booking",
    he: {
      name: "כושר / סטודיו / מאמן אישי",
      flow: ["לברך ולשאול מה המטרה (ירידה במשקל, כוח, גמישות)", "ניסיון קודם ומגבלות", "להציע מנוי או אימון ניסיון", "להציע מועד בשעות הסטודיו", "לבקש שם וטלפון", "לאשר ולשלוח מה להביא"],
      fields: ["מטרה", "ניסיון", "ימים נוחים"],
      menu: ["🏋️ אימונים", "🆓 אימון ניסיון", "💳 מנויים", "🗓️ מערכת שעות"],
      pricing: "מנוי חודשי 250 ₪, כרטיסייה 10 כניסות 400 ₪.\nאימון ניסיון ב-30 ₪.",
    },
    en: {
      name: "Fitness / studio / personal trainer",
      flow: ["Greet and ask the goal", "Experience and limitations", "Offer a membership or trial", "Offer a time within studio hours", "Ask for name + phone", "Confirm and say what to bring"],
      fields: ["Goal", "Experience", "Preferred days"],
      menu: ["🏋️ Classes", "🆓 Trial", "💳 Memberships", "🗓️ Timetable"],
      pricing: "Monthly $70, 10-pass $110. Trial $8.",
    },
  },
  {
    key: "auto",
    emoji: "🚗",
    goal: "booking",
    he: {
      name: "מוסך / טיפולי רכב",
      flow: ["לברך ולשאול מה הבעיה או איזה טיפול", "דגם, שנה וקילומטראז׳", "לתת מחיר משוער ומשך", "להציע מועד בשעות המוסך", "לבקש שם, טלפון ומספר רכב", "לאשר ולהזכיר להגיע בזמן"],
      fields: ["דגם ושנה", "קילומטראז׳", "סוג הטיפול/תקלה", "מספר רכב"],
      menu: ["🔧 טיפולים", "📅 קביעת תור", "💰 מחירון", "🚨 תקלה דחופה"],
      pricing: "טיפול 10,000 ק״מ מ-450 ₪, אבחון 150 ₪.\nאין הנחות בחלקים.",
    },
    en: {
      name: "Garage / car service",
      flow: ["Greet and ask the problem or service", "Model, year and mileage", "Give an estimate and duration", "Offer a slot within garage hours", "Ask for name, phone and plate", "Confirm"],
      fields: ["Model & year", "Mileage", "Service/issue", "Plate"],
      menu: ["🔧 Services", "📅 Book", "💰 Prices", "🚨 Urgent"],
      pricing: "Service from $120, diagnosis $40.",
    },
  },
  {
    key: "pets",
    emoji: "🐶",
    goal: "booking",
    he: {
      name: "חיות מחמד / טיפוח / פנסיון",
      flow: ["לברך ולשאול על החיה והשירות", "גודל, גזע ומזג", "מחיר לפי גודל", "להציע מועד פנוי", "לבקש שם וטלפון", "לאשר ולהזכיר הנחיות"],
      fields: ["סוג וגזע", "גודל", "שירות", "מועד"],
      menu: ["🐶 שירותים", "📅 קביעת תור", "💰 מחירים", "🖼️ לפני ואחרי"],
      pricing: "תספורת כלב קטן 150 ₪, גדול 220 ₪.\nעד 10% הנחה לשני כלבים באותו תור.",
    },
    en: {
      name: "Pets / grooming / boarding",
      flow: ["Greet and ask about the pet and service", "Size, breed, temperament", "Price by size", "Offer a slot", "Ask for name + phone", "Confirm"],
      fields: ["Species & breed", "Size", "Service", "Date"],
      menu: ["🐶 Services", "📅 Book", "💰 Prices", "🖼️ Before & after"],
      pricing: "Small dog $40, large $60. Up to 10% off for two dogs.",
    },
  },
  {
    key: "events",
    emoji: "📸",
    goal: "lead",
    he: {
      name: "אירועים / צלמים / הפקות",
      flow: ["לברך ולשאול איזה אירוע", "תאריך, מקום ומספר אורחים", "להציג חבילות ומחירים", "לשלוח דוגמאות מהגלריה", "לבדוק זמינות לתאריך", "לבקש שם וטלפון ולקבוע פגישת היכרות"],
      fields: ["סוג אירוע", "תאריך", "מקום", "מספר אורחים", "תקציב"],
      menu: ["📸 חבילות", "🖼️ עבודות", "📅 בדיקת תאריך", "💬 פגישת היכרות"],
      pricing: "חבילת בסיס 3,500 ₪, פרימיום 6,000 ₪.\nעד 5% הנחה בסגירה בפגישה הראשונה.",
    },
    en: {
      name: "Events / photographers",
      flow: ["Greet and ask the event", "Date, venue and guests", "Present packages and prices", "Send gallery examples", "Check date availability", "Ask for name + phone and book a meeting"],
      fields: ["Event", "Date", "Venue", "Guests", "Budget"],
      menu: ["📸 Packages", "🖼️ Work", "📅 Check a date", "💬 Meet us"],
      pricing: "Basic $1,000, premium $1,700. Up to 5% off when booking at the first meeting.",
    },
  },
  {
    key: "professional",
    emoji: "⚖️",
    goal: "lead",
    he: {
      name: "עו״ד / רו״ח / יועצים",
      flow: ["לברך ולשאול במה מדובר (בלי ייעוץ משפטי בצ׳אט)", "להבין את סוג התיק והדחיפות", "להסביר איך עובדים ומחיר פגישת ייעוץ", "להציע מועד לפגישה", "לבקש שם, טלפון ומייל", "לאשר ולשלוח מה להכין לפגישה"],
      fields: ["תחום", "דחיפות", "מועד מועדף"],
      menu: ["⚖️ תחומים", "📅 פגישת ייעוץ", "💰 עלויות", "📞 שיחה חוזרת"],
      pricing: "פגישת ייעוץ ראשונה 400 ₪ (מקוזזת בהתקשרות).\nאין הנחות.",
    },
    en: {
      name: "Lawyer / accountant / consultant",
      flow: ["Greet and ask the matter (no legal advice in chat)", "Understand the case type and urgency", "Explain the process and consultation price", "Offer a meeting time", "Ask for name, phone and e-mail", "Confirm and say what to prepare"],
      fields: ["Field", "Urgency", "Preferred time"],
      menu: ["⚖️ Practice areas", "📅 Consultation", "💰 Fees", "📞 Call back"],
      pricing: "First consultation $110 (credited when engaged).",
    },
  },
];

export function industryByKey(key: string | null | undefined): IndustryTemplate | null {
  return INDUSTRIES.find((i) => i.key === key) ?? null;
}
