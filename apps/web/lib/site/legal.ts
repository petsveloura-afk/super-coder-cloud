/**
 * Wave 13 — legal pages for published websites, generated from the business details
 * (privacy policy, terms of use, accessibility statement, cookie policy).
 * General templates that follow common Israeli practice (Privacy Protection Law,
 * Equal Rights for Persons with Disabilities regulations / IS 5568 = WCAG 2.0 AA) —
 * the builder says clearly that they are not legal advice and can be edited.
 * Format: plain text, "## " headings, "- " bullets, blank line = paragraph.
 */
export const LEGAL_KEYS = ["privacy", "terms", "accessibility", "cookies"] as const;
export type LegalKey = (typeof LEGAL_KEYS)[number];

export interface LegalInput {
  siteName: string;
  legalName?: string;
  businessId?: string;
  email?: string;
  phone?: string;
  address?: string;
  a11yContact?: string;
  /** "2026-10-17" */
  updated?: string;
  hasForms?: boolean;
  hasBooking?: boolean;
  hasChat?: boolean;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function who(i: LegalInput, he: boolean) {
  const name = clean(i.legalName) || clean(i.siteName);
  const id = clean(i.businessId);
  return id ? `${name} (${he ? "ח.פ./ע.מ." : "Reg. no."} ${id})` : name;
}

function contactLines(i: LegalInput, he: boolean): string {
  const lines = [
    clean(i.email) ? `- ${he ? "אימייל" : "E-mail"}: ${clean(i.email)}` : "",
    clean(i.phone) ? `- ${he ? "טלפון" : "Phone"}: ${clean(i.phone)}` : "",
    clean(i.address) ? `- ${he ? "כתובת" : "Address"}: ${clean(i.address)}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : he ? "- דרך טופס יצירת הקשר באתר" : "- Through the contact form on this website";
}

export const LEGAL_TITLES: Record<"he" | "en" | "ar", Record<LegalKey, string>> = {
  he: { privacy: "מדיניות פרטיות", terms: "תנאי שימוש", accessibility: "הצהרת נגישות", cookies: "מדיניות עוגיות" },
  en: { privacy: "Privacy policy", terms: "Terms of use", accessibility: "Accessibility statement", cookies: "Cookie policy" },
  ar: { privacy: "سياسة الخصوصية", terms: "شروط الاستخدام", accessibility: "بيان إمكانية الوصول", cookies: "سياسة ملفات تعريف الارتباط" },
};

export function legalText(key: LegalKey, locale: string, i: LegalInput): string {
  const he = locale === "he";
  const date = i.updated ?? new Date().toISOString().slice(0, 10);
  const owner = who(i, he);
  const site = clean(i.siteName);
  if (he) {
    switch (key) {
      case "privacy":
        return [
          `עודכן לאחרונה: ${date}`,
          `${owner} ("העסק") מכבד את פרטיות המשתמשים באתר ${site}. מדיניות זו מסבירה איזה מידע נאסף, למה, ומה הזכויות שלך.`,
          "## איזה מידע נאסף",
          [
            "- מידע שאת/ה מוסר/ת מרצונך: שם, טלפון, אימייל ותוכן הפנייה",
            i.hasForms ? "- פרטים שממולאים בטפסים באתר" : "",
            i.hasBooking ? "- פרטי תורים ופגישות שנקבעו דרך האתר" : "",
            i.hasChat ? "- תוכן שיחות בצ׳אט של האתר (כולל מענה אוטומטי)" : "",
            "- מידע טכני בסיסי: סוג דפדפן, עמודים שנצפו ונתוני ביקור מצטברים",
          ]
            .filter(Boolean)
            .join("\n"),
          "## למה משתמשים במידע",
          "- כדי לחזור אליך ולתת את השירות שביקשת\n- כדי לקבוע ולנהל תורים והזמנות\n- כדי לשפר את האתר והשירות\n- לשליחת עדכונים ודיוור, רק אם הסכמת לכך. אפשר להסיר את עצמך בכל עת",
          "## שמירה ואבטחה",
          "המידע נשמר במערכות מאובטחות, הגישה אליו מוגבלת לאנשים שזקוקים לה, והוא נשמר רק כל עוד יש בו צורך לשירות או לפי דין.",
          "## העברה לצדדים שלישיים",
          "העסק לא מוכר מידע אישי. מידע עשוי לעבור לספקי שירות שמפעילים עבורנו את האתר, הדיוור, התשלומים והתקשורת, רק לצורך מתן השירות ובכפוף לחובת סודיות, או אם הדין מחייב זאת.",
          "## הזכויות שלך",
          "לפי חוק הגנת הפרטיות, התשמ״א-1981, אפשר לבקש לעיין במידע שנשמר עליך, לתקן אותו או למחוק אותו. פנייה בעניין:",
          contactLines(i, true),
          "## שינויים",
          "העסק רשאי לעדכן את המדיניות מעת לעת. הגרסה העדכנית תמיד מופיעה בעמוד זה.",
        ].join("\n\n");
      case "terms":
        return [
          `עודכן לאחרונה: ${date}`,
          `ברוכים הבאים לאתר ${site}, שמופעל על ידי ${owner}. השימוש באתר כפוף לתנאים אלה.`,
          "## השימוש באתר",
          "- המידע באתר נועד למידע כללי בלבד ואינו מהווה הצעה מחייבת. מחירים, זמינות ומבצעים עשויים להשתנות\n- אין להשתמש באתר לפעולה בלתי חוקית, לשלוח תוכן פוגעני או לנסות לפגוע בפעילות האתר",
          "## קניין רוחני",
          `כל התכנים באתר, כולל טקסטים, עיצוב, לוגו ותמונות, שייכים ל${clean(i.legalName) || site} או לבעלי הזכויות בהם. אין להעתיק, להפיץ או לעשות בהם שימוש מסחרי בלי אישור בכתב. © ${new Date(date).getFullYear()} כל הזכויות שמורות.`,
          "## הזמנות, תורים ותשלומים",
          "הזמנה או תור נחשבים סופיים רק אחרי אישור מהעסק. ביטול עסקה לפי חוק הגנת הצרכן, התשמ״א-1981, ותקנותיו.",
          "## אחריות",
          "העסק עושה מאמץ שהמידע באתר יהיה מדויק ועדכני, אבל לא אחראי לטעויות, להפסקות בשירות או לנזק עקיף מהשימוש באתר, ככל שהדין מתיר.",
          "## קישורים חיצוניים",
          "קישורים לאתרים אחרים מובאים לנוחות בלבד, והעסק אינו אחראי לתוכנם.",
          "## דין וסמכות שיפוט",
          "על התנאים יחולו דיני מדינת ישראל, והסמכות הבלעדית נתונה לבתי המשפט המוסמכים בישראל.",
          "## יצירת קשר",
          contactLines(i, true),
        ].join("\n\n");
      case "accessibility":
        return [
          `עודכן לאחרונה: ${date}`,
          `${owner} רואה חשיבות במתן שירות שוויוני ונגיש לכל האנשים, כולל אנשים עם מוגבלות, ופועל להנגיש את האתר ${site} לפי תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013.`,
          "## רמת הנגישות",
          "האתר נבנה בהתאם להמלצות התקן הישראלי ת״י 5568, ברמת AA של הנחיות WCAG 2.0.",
          "## מה הותאם באתר",
          "- מבנה כותרות ברור וניווט מלא במקלדת\n- טקסט חלופי לתמונות ותוויות לשדות בטפסים\n- ניגודיות צבעים מספקת והתאמה למסכים ניידים\n- תפריט נגישות: הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים ועצירת אנימציות\n- כיבוד הגדרת המערכת להפחתת תנועה",
          "## הסתייגות",
          "למרות המאמצים, ייתכן שחלקים באתר עדיין אינם נגישים במלואם, למשל תוכן שהועלה על ידי צד שלישי. אנחנו ממשיכים לשפר.",
          "## פנייה בנושא נגישות",
          `נתקלת בבעיה? נשמח לשמוע ולתקן.${clean(i.a11yContact) ? ` רכז/ת הנגישות: ${clean(i.a11yContact)}.` : ""}`,
          contactLines(i, true),
        ].join("\n\n");
      case "cookies":
        return [
          `עודכן לאחרונה: ${date}`,
          `האתר ${site} משתמש בעוגיות (Cookies) ובאחסון מקומי בדפדפן כדי שהאתר יעבוד כראוי ולהבנת השימוש בו.`,
          "## סוגי העוגיות",
          "- הכרחיות: לפעולת האתר, למשל זכירת הבחירה שלך לגבי עוגיות והגדרות הנגישות\n- סטטיסטיקה מצטברת: ספירת ביקורים בלי לזהות אותך אישית\n- צ׳אט: שמירת השיחה בדפדפן שלך כדי שתוכל/י להמשיך אותה",
          "## שליטה בעוגיות",
          "אפשר למחוק או לחסום עוגיות בהגדרות הדפדפן. חסימה עלולה לפגוע בחלק מהפעולות באתר.",
          "## יצירת קשר",
          contactLines(i, true),
        ].join("\n\n");
    }
  }
  switch (key) {
    case "privacy":
      return [
        `Last updated: ${date}`,
        `${owner} ("the business") respects the privacy of visitors to ${site}. This policy explains what we collect, why, and your rights.`,
        "## What we collect",
        [
          "- Details you give us: name, phone, e-mail and your message",
          i.hasForms ? "- Details entered in forms on this website" : "",
          i.hasBooking ? "- Appointments booked through this website" : "",
          i.hasChat ? "- Website chat conversations (including automated replies)" : "",
          "- Basic technical data: browser type, pages viewed and aggregated visit statistics",
        ]
          .filter(Boolean)
          .join("\n"),
        "## Why we use it",
        "- To get back to you and provide the service you asked for\n- To schedule and manage bookings and orders\n- To improve the website and our service\n- To send updates and newsletters only if you agreed; you can unsubscribe at any time",
        "## Storage and security",
        "Data is kept in secure systems, access is limited to people who need it, and it is kept only as long as needed for the service or required by law.",
        "## Sharing",
        "We never sell personal data. Data may be shared with service providers that run our website, e-mail, payments and messaging, only to provide the service and under confidentiality, or when the law requires it.",
        "## Your rights",
        "You may ask to see, correct or delete the data we hold about you. Contact:",
        contactLines(i, false),
        "## Changes",
        "We may update this policy from time to time; the current version is always on this page.",
      ].join("\n\n");
    case "terms":
      return [
        `Last updated: ${date}`,
        `Welcome to ${site}, operated by ${owner}. Using this website means you accept these terms.`,
        "## Using the website",
        "- Information on this website is general and is not a binding offer; prices, availability and promotions may change\n- Do not use the website for unlawful purposes, to send abusive content or to disrupt it",
        "## Intellectual property",
        `All content on this website (texts, design, logo and images) belongs to ${clean(i.legalName) || site} or its licensors. Do not copy, distribute or use it commercially without written permission. © ${new Date(date).getFullYear()} All rights reserved.`,
        "## Orders, bookings and payments",
        "An order or booking is final only once the business confirms it. Cancellations follow applicable consumer-protection law.",
        "## Liability",
        "We work to keep information accurate and current but, to the extent the law allows, are not liable for errors, interruptions or indirect damage from using the website.",
        "## External links",
        "Links to other websites are provided for convenience; we are not responsible for their content.",
        "## Governing law",
        "These terms are governed by the laws of the business's country of registration, and its competent courts have exclusive jurisdiction.",
        "## Contact",
        contactLines(i, false),
      ].join("\n\n");
    case "accessibility":
      return [
        `Last updated: ${date}`,
        `${owner} is committed to equal, accessible service for everyone, including people with disabilities, and works to make ${site} accessible.`,
        "## Accessibility level",
        "The website is built to follow WCAG 2.0 level AA (Israeli standard IS 5568).",
        "## What we did",
        "- Clear heading structure and full keyboard navigation\n- Text alternatives for images and labels for form fields\n- Sufficient colour contrast and a mobile-friendly layout\n- An accessibility menu: larger text, high contrast, highlighted links and stopping animations\n- Respect for the system's reduced-motion setting",
        "## Limitations",
        "Despite our efforts, some parts may not yet be fully accessible, for example third-party content. We keep improving.",
        "## Contact us about accessibility",
        `Found a problem? We would like to hear about it and fix it.${clean(i.a11yContact) ? ` Accessibility coordinator: ${clean(i.a11yContact)}.` : ""}`,
        contactLines(i, false),
      ].join("\n\n");
    case "cookies":
      return [
        `Last updated: ${date}`,
        `${site} uses cookies and local browser storage so the website works properly and to understand how it is used.`,
        "## Types of cookies",
        "- Essential: for the website to work, e.g. remembering your cookie choice and accessibility settings\n- Aggregated statistics: counting visits without identifying you\n- Chat: keeping your chat in your browser so you can continue it",
        "## Managing cookies",
        "You can delete or block cookies in your browser settings; blocking may affect some features.",
        "## Contact",
        contactLines(i, false),
      ].join("\n\n");
  }
}

/** Parses the simple legal-text format into renderable parts. */
export type LegalPart = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] };
export function parseLegal(text: string): LegalPart[] {
  const out: LegalPart[] = [];
  for (const chunk of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const c = chunk.trim();
    if (!c) continue;
    if (c.startsWith("## ")) out.push({ kind: "h", text: c.slice(3).trim() });
    else if (c.split("\n").every((l) => l.trim().startsWith("- "))) out.push({ kind: "ul", items: c.split("\n").map((l) => l.trim().slice(2).trim()) });
    else out.push({ kind: "p", text: c });
  }
  return out;
}
