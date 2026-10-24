/**
 * Wave 21 — the platform's own legal pages (privacy policy, terms of use, data deletion).
 * Required by Meta (WhatsApp / Messenger / Instagram), Google and Shopify app reviews.
 * Business details come from the environment (never hard-coded):
 *   BILLING_BUSINESS_NAME  (e.g. "Super Coder")      BILLING_BUSINESS_ID (e.g. "עוסק מורשה 123456789")
 *   LEGAL_CONTACT_EMAIL    (e.g. privacy@your-domain) — optional; without it the help center is linked.
 * This is a solid starting text, not legal advice — the business owner should have it reviewed.
 */
export type LegalDoc = "privacy" | "terms" | "data-deletion";
export const LEGAL_DOCS: LegalDoc[] = ["privacy", "terms", "data-deletion"];
export const LEGAL_UPDATED = "2026-10-24";

export interface LegalSection {
  h: string;
  p: string[];
}
export interface LegalContent {
  title: string;
  intro: string;
  sections: LegalSection[];
}

interface Vars {
  name: string;
  id: string;
  email: string | null;
  site: string;
}

export function legalVars(env: Record<string, string | undefined>, appUrl: string): Vars {
  return {
    name: (env.BILLING_BUSINESS_NAME || "Super Coder Cloud").trim(),
    id: (env.BILLING_BUSINESS_ID || "").trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.LEGAL_CONTACT_EMAIL ?? "") ? env.LEGAL_CONTACT_EMAIL!.trim() : null,
    site: appUrl.replace(/\/$/, ""),
  };
}

function contactHe(v: Vars) {
  return v.email ? `במייל ${v.email}` : `דרך מרכז העזרה באתר (${v.site}/he/help)`;
}
function contactEn(v: Vars) {
  return v.email ? `by e-mail at ${v.email}` : `through the help center (${v.site}/en/help)`;
}

export function legalContent(doc: LegalDoc, lang: "he" | "en", v: Vars): LegalContent {
  const who = v.id ? `${v.name} (${v.id})` : v.name;
  if (lang === "he") {
    if (doc === "privacy")
      return {
        title: "מדיניות פרטיות",
        intro: `${who} ("אנחנו") מפעילה את הפלטפורמה ${v.site} — מערכת לניהול לקוחות, הודעות וסוכני AI לעסקים. כאן מוסבר איזה מידע נאסף, למה, עם מי הוא משותף ואיך מוחקים אותו.`,
        sections: [
          { h: "מי אחראי על המידע", p: ["כשעסק משתמש בפלטפורמה, העסק הוא הבעלים של המידע על הלקוחות שלו, ואנחנו מעבדים אותו בשמו ולפי הוראותיו. על המידע של המשתמשים עצמם (חשבון, חיוב) אנחנו האחראים."] },
          { h: "איזה מידע נאסף", p: ["פרטי חשבון: שם, מייל, טלפון, סיסמה מוצפנת, שפה ואזור זמן.", "מידע שהעסק מזין או שמגיע מהערוצים שהוא חיבר: אנשי קשר, עסקאות, משימות, פגישות, חשבוניות והודעות.", "מערוצי Meta (וואטסאפ, מסנג'ר, אינסטגרם) — רק מהחשבונות שהעסק חיבר בעצמו: מזהה העמוד / החשבון / המספר, שם ותמונת הפרופיל של מי שכותב לעסק, תוכן ההודעות, התגובות לפוסטים, ומדיה שנשלחה בשיחה.", "מגוגל (כשהעסק חיבר): אירועי היומן, מיילים בתיבה שחוברה, וביקורות בפרופיל העסק.", "מידע טכני: כתובת IP, סוג דפדפן ויומני שימוש לצורכי אבטחה ותפעול."] },
          { h: "למה משתמשים במידע", p: ["כדי לספק את השירות: להציג את ההודעות בתיבה אחת, לאפשר לעסק ולסוכן ה-AI שלו לענות ללקוחות, לנהל לידים, פגישות ותשלומים.", "כדי לאבטח את המערכת, למנוע שימוש לרעה ולעמוד בדרישות החוק.", "לא מוכרים מידע, לא משתמשים בו לפרסום של צד שלישי, ולא משתמשים במידע שהגיע מ-Meta או מגוגל לשום מטרה אחרת מלבד מתן השירות לעסק שחיבר אותו."] },
          { h: "בינה מלאכותית", p: ["כשסוכן ה-AI של העסק עונה ללקוח, תוכן השיחה הרלוונטי נשלח לספק מודל שפה (למשל Google Gemini, Anthropic, OpenAI, Groq) רק כדי לנסח את התשובה. לפי תנאי הספקים, המידע לא משמש לאימון המודלים שלהם במסגרת השימוש העסקי."] },
          { h: "עם מי המידע משותף", p: ["ספקי תשתית שעובדים בשבילנו: אחסון ומסד נתונים (Supabase), אירוח (Vercel, Railway), שליחת מיילים, סליקה (PayPal ואחרים) וספקי ה-AI שלמעלה — כולם רק במידה הנדרשת לשירות.", "Meta, גוגל ופלטפורמות אחרות — רק כשהעסק מבקש לשלוח דרכן הודעה או פעולה.", "רשויות — רק כשהחוק מחייב."] },
          { h: "אבטחה ושמירה", p: ["המידע מוצפן בתעבורה, מפתחות וסודות של ערוצים מוצפנים במסד הנתונים, וכל עסק רואה רק את המידע שלו (הפרדה ברמת מסד הנתונים).", "המידע נשמר כל עוד החשבון פעיל או כפי שהעסק מגדיר. אחרי מחיקה הוא נמחק מהמערכות הפעילות תוך 30 יום, ומהגיבויים לפי מחזור הגיבוי."] },
          { h: "הזכויות שלך", p: [`אפשר לבקש לעיין במידע, לתקן אותו או למחוק אותו — ${contactHe(v)}. לקוח של עסק שמשתמש בפלטפורמה יכול לפנות ישירות לעסק, או אלינו ונעביר את הבקשה. בקשה לעצור הודעות: כותבים "הסר" או "stop" בשיחה.`, `הוראות מחיקה מפורטות (כולל למידע שהגיע מפייסבוק ואינסטגרם): ${v.site}/he/legal/data-deletion`] },
          { h: "יצירת קשר ושינויים", p: [`שאלות על פרטיות: ${contactHe(v)}. נעדכן את המדיניות מעת לעת, ותאריך העדכון האחרון מופיע בראש העמוד.`] },
        ],
      };
    if (doc === "terms")
      return {
        title: "תנאי שימוש",
        intro: `תנאים אלה חלים על השימוש בפלטפורמה ${v.site} שמפעילה ${who}. השימוש בפלטפורמה מהווה הסכמה להם.`,
        sections: [
          { h: "השירות", p: ["מערכת לניהול לקוחות, תיבת הודעות מאוחדת, אוטומציות, סוכני AI, אתרים, תשלומים וכלים נוספים לעסקים. חלק מהיכולות דורשות חיבור לשירותי צד שלישי (Meta, גוגל, Shopify ועוד) וכפופות גם לתנאים שלהם."] },
          { h: "החשבון שלך", p: ["אתה אחראי על פרטי ההתחברות, על המשתמשים שהזמנת ועל התוכן שנשלח מהחשבון.", "הודעות ללקוחות נשלחות רק למי שפנה לעסק או נתן הסכמה. אסור להשתמש בפלטפורמה לספאם, להטעיה, לתוכן בלתי חוקי או בניגוד למדיניות של וואטסאפ ו-Meta."] },
          { h: "סוכני AI", p: ["הסוכן עונה לפי ההנחיות והמידע שהעסק הזין. העסק אחראי לבדוק את ההגדרות, המחירים והמידע שהסוכן מוסר, ויכול בכל רגע לקחת שיחה לידיו."] },
          { h: "תשלום", p: ["תוכניות בתשלום מחויבות מראש לתקופה שנבחרה. אפשר לבטל בכל עת, והביטול נכנס לתוקף בסוף התקופה ששולמה, אלא אם החוק קובע אחרת."] },
          { h: "זמינות ואחריות", p: ["אנחנו עושים כל מאמץ שהשירות יהיה זמין ומדויק, אבל הוא ניתן כמו שהוא. שירותי צד שלישי (Meta, ספקי AI, סליקה) עלולים להשתנות או להיעצר שלא בשליטתנו. האחריות שלנו מוגבלת לסכום ששולם לנו ב-12 החודשים האחרונים, ככל שהחוק מתיר."] },
          { h: "סיום", p: ["אפשר לסגור את החשבון בכל עת. אנחנו רשאים להשעות חשבון שמפר את התנאים. אחרי סגירה המידע נמחק כמתואר במדיניות הפרטיות."] },
          { h: "דין וסמכות", p: [`על התנאים חל הדין הישראלי, וסמכות השיפוט לבתי המשפט בישראל. יצירת קשר: ${contactHe(v)}.`] },
        ],
      };
    return {
      title: "מחיקת נתונים",
      intro: `איך מוחקים מידע מהפלטפורמה ${v.site}, כולל מידע שהגיע מפייסבוק, מאינסטגרם ומוואטסאפ.`,
      sections: [
        { h: "לעסקים שמשתמשים בפלטפורמה", p: ["ניתוק ערוץ: אינטגרציות ← הערוץ ← ניתוק. החיבור והטוקנים נמחקים מיד.", "מחיקת איש קשר והשיחות שלו: אנשי קשר ← איש הקשר ← מחיקה.", `מחיקת כל החשבון והמידע של העסק: שולחים בקשה ${contactHe(v)} מהמייל של בעל החשבון. המחיקה מתבצעת תוך 30 יום ומאושרת במייל.`] },
        { h: "למי שכתב לעסק בפייסבוק, אינסטגרם או וואטסאפ", p: [`פונים לעסק עצמו, או אלינו ${contactHe(v)} עם שם העסק והחשבון שממנו כתבתם. נמחק את ההודעות והפרטים שלכם תוך 30 יום ונאשר.`, "אפשר גם להסיר את הגישה מפייסבוק: הגדרות ← אבטחה והתחברות ← אפליקציות ואתרים / Business Integrations ← הסרה."] },
        { h: "מה נמחק", p: ["ההודעות, פרטי הקשר, המזהים מהפלטפורמות ומדיה שנשמרה. רשומות שהחוק מחייב לשמור (למשל חשבוניות) נשמרות רק לתקופה שהחוק קובע."] },
      ],
    };
  }
  // English
  if (doc === "privacy")
    return {
      title: "Privacy Policy",
      intro: `${who} ("we") operates ${v.site} — a customer-management, messaging and AI-agent platform for businesses. This explains what we collect, why, who we share it with and how to delete it.`,
      sections: [
        { h: "Who is responsible", p: ["When a business uses the platform, the business owns its customers' data and we process it on its behalf and instructions. For users' own account and billing data, we are responsible."] },
        { h: "What we collect", p: ["Account details: name, e-mail, phone, hashed password, language and time zone.", "Data a business enters or that arrives from channels it connected: contacts, deals, tasks, appointments, invoices and messages.", "From Meta channels (WhatsApp, Messenger, Instagram) — only from accounts the business connected itself: the page / account / number ID, the name and profile picture of people who message the business, message content, comments on posts, and media sent in conversations.", "From Google (when connected): calendar events, e-mails in the connected mailbox, and Business Profile reviews.", "Technical data: IP address, browser type and usage logs for security and operations."] },
        { h: "How we use it", p: ["To provide the service: one inbox for all messages, letting the business and its AI agent answer customers, managing leads, appointments and payments.", "To secure the system, prevent abuse and meet legal obligations.", "We do not sell data, do not use it for third-party advertising, and use data from Meta or Google for no purpose other than providing the service to the business that connected it."] },
        { h: "Artificial intelligence", p: ["When a business's AI agent answers a customer, the relevant conversation content is sent to a language-model provider (e.g. Google Gemini, Anthropic, OpenAI, Groq) only to draft the answer. Under the providers' business terms, this data is not used to train their models."] },
        { h: "Who we share it with", p: ["Infrastructure providers working for us: storage and database (Supabase), hosting (Vercel, Railway), e-mail delivery, payments (PayPal and others) and the AI providers above — only as needed for the service.", "Meta, Google and other platforms — only when the business asks to send a message or action through them.", "Authorities — only when required by law."] },
        { h: "Security and retention", p: ["Data is encrypted in transit, channel keys and secrets are encrypted in the database, and each business only sees its own data (database-level isolation).", "Data is kept while the account is active or as the business configures. After deletion it is removed from live systems within 30 days and from backups on the backup cycle."] },
        { h: "Your rights", p: [`You can ask to access, correct or delete data — ${contactEn(v)}. A customer of a business on the platform can contact the business directly, or us and we will forward the request. To stop messages, write "stop" in the conversation.`, `Detailed deletion instructions (including data from Facebook and Instagram): ${v.site}/en/legal/data-deletion`] },
        { h: "Contact and changes", p: [`Privacy questions: ${contactEn(v)}. We update this policy from time to time; the last-updated date is shown at the top.`] },
      ],
    };
  if (doc === "terms")
    return {
      title: "Terms of Use",
      intro: `These terms apply to the use of ${v.site}, operated by ${who}. Using the platform means you accept them.`,
      sections: [
        { h: "The service", p: ["Customer management, a unified inbox, automations, AI agents, websites, payments and more tools for businesses. Some features require connecting third-party services (Meta, Google, Shopify and others) and are also subject to their terms."] },
        { h: "Your account", p: ["You are responsible for your login details, the users you invite and the content sent from the account.", "Messages are sent only to people who contacted the business or gave consent. The platform may not be used for spam, deception, illegal content or anything against WhatsApp and Meta policies."] },
        { h: "AI agents", p: ["The agent answers according to the instructions and information the business entered. The business is responsible for reviewing the settings, prices and information the agent gives, and can take over any conversation at any time."] },
        { h: "Payment", p: ["Paid plans are billed in advance for the chosen period. You can cancel at any time; cancellation takes effect at the end of the paid period unless the law says otherwise."] },
        { h: "Availability and liability", p: ["We do our best to keep the service available and accurate, but it is provided as is. Third-party services (Meta, AI providers, payments) may change or stop outside our control. Our liability is limited to the amount paid to us in the last 12 months, as far as the law allows."] },
        { h: "Termination", p: ["You can close your account at any time. We may suspend an account that breaches these terms. After closing, data is deleted as described in the privacy policy."] },
        { h: "Law", p: [`These terms are governed by the laws of Israel, with jurisdiction to the courts of Israel. Contact: ${contactEn(v)}.`] },
      ],
    };
  return {
    title: "Data Deletion",
    intro: `How to delete data from ${v.site}, including data received from Facebook, Instagram and WhatsApp.`,
    sections: [
      { h: "Businesses using the platform", p: ["Disconnect a channel: Integrations → the channel → Disconnect. The connection and its tokens are deleted immediately.", "Delete a contact and their conversations: Contacts → the contact → Delete.", `Delete the whole account and all business data: send a request ${contactEn(v)} from the account owner's e-mail. Deletion is completed within 30 days and confirmed by e-mail.`] },
      { h: "People who messaged a business on Facebook, Instagram or WhatsApp", p: [`Contact the business itself, or us ${contactEn(v)} with the business name and the account you wrote from. We delete your messages and details within 30 days and confirm.`, "You can also remove access from Facebook: Settings → Security and login → Apps and websites / Business Integrations → Remove."] },
      { h: "What is deleted", p: ["Messages, contact details, platform IDs and stored media. Records the law requires us to keep (such as invoices) are kept only for the legally required period."] },
    ],
  };
}
