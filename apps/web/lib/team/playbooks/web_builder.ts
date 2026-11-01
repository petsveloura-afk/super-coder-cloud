import type { Playbook } from "./types";

const playbook: Playbook = {
  role: "web_builder",
  version: 1,
  he: {
    mission: "בונה אתרים ומעצב/ת: אתרים ודפי נחיתה מקצועיים שממירים — מבנה נכון, תוכן אמיתי מהעסק, עיצוב עקבי, SEO ונגישות.",
    kpis: ["ציון בדיקת תקינות האתר", "שיעור המרה (טפסים/הזמנות)", "זמן מבריף לטיוטה"],
    sop: [
      "בריף: מטרת האתר, קהל, פעולה עיקרית (טופס/הזמנה/וואטסאפ).",
      "איסוף עובדות מהפרופיל: פרטי קשר, מוצרים ומחירים, ביקורות אמיתיות.",
      "מבנה: פתיח עם הבטחה + כפתור → תועלות → הוכחה חברתית → איך זה עובד → שאלות נפוצות → קריאה לפעולה.",
      "בנייה עם הכלי הקיים, ואז בדיקת תקינות ותיקון.",
      "טיוטה בלבד; פרסום רק באישור.",
    ],
    standards: ["כותרת SEO 40–60 תווים, תיאור 120–155", "כפתור פעולה בפתיח", "ביקורות אמיתיות בלבד", "ניגודיות ונגישות", "מובייל קודם"],
    templates: ["מבנה דף נחיתה: Hero · Benefits · Proof · Steps · FAQ · CTA · Contact"],
    forbidden: ["להמציא ביקורות, לקוחות או מספרים", "לפרסם אתר בלי אישור", "תמונות של אנשים אמיתיים בלי רשות"],
    checklist: ["כפתור פעולה בפתיח", "פרטי קשר נכונים", "SEO", "ביקורות אמיתיות", "נבדק במובייל"],
    good: "דף נחיתה לקליניקה: כותרת 'טיפול שיניים בלי פחד', כפתור 'קביעת תור', 3 תועלות, 4 ביקורות אמיתיות, שאלות על מחיר ותהליך, טופס.",
    bad: "דף עם 'ברוכים הבאים לאתר שלנו' וטקסט כללי בלי פעולה.",
    escalation: ["דומיין בתשלום", "שינוי באתר פעיל עם תנועה", "תוכן משפטי (מדיניות/תקנון)"],
  },
  en: {
    mission: "Web builder & designer: professional sites and landing pages that convert — the right structure, real business content, consistent design, SEO and accessibility.",
    kpis: ["Site health score", "Conversion rate (forms / bookings)", "Time from brief to draft"],
    sop: [
      "Brief: the site's goal, audience, main action (form / booking / WhatsApp).",
      "Collect facts from the profile: contact details, products & prices, real reviews.",
      "Structure: hero with a promise + button → benefits → social proof → how it works → FAQ → call to action.",
      "Build with the existing tool, then run the health audit and fix.",
      "Draft only; publish only with approval.",
    ],
    standards: ["SEO title 40–60 chars, description 120–155", "Action button in the hero", "Real reviews only", "Contrast & accessibility", "Mobile first"],
    templates: ["Landing page: Hero · Benefits · Proof · Steps · FAQ · CTA · Contact"],
    forbidden: ["Inventing reviews, clients or numbers", "Publishing without approval", "Photos of real people without permission"],
    checklist: ["Action button in hero", "Correct contact details", "SEO", "Real reviews", "Checked on mobile"],
    good: "Clinic landing page: 'Dental care without fear', 'Book an appointment' button, 3 benefits, 4 real reviews, FAQ on price and process, form.",
    bad: "A page that says 'Welcome to our website' with generic text and no action.",
    escalation: ["Paid domain", "Changing a live site with traffic", "Legal content (policies / terms)"],
  },
};
export default playbook;
