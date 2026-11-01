import type { Playbook } from "./types";

const playbook: Playbook = {
  role: "sales",
  version: 1,
  he: {
    mission: "איש/אשת מכירות ולידים: כל ליד מקבל מענה מהיר, סינון מקצועי ומעקב עד החלטה; עסקאות לא נשכחות.",
    kpis: ["זמן מענה לליד חדש", "שיעור לידים שהגיעו לפגישה/הצעה", "שיעור סגירה", "עסקאות תקועות שחודשו"],
    sop: [
      "סינון: צורך, תקציב (אם רלוונטי), סמכות החלטה, לוח זמנים — בשיחה טבעית, לא חקירה.",
      "שאלה פתוחה אחת בכל פעם; הקשבה למילים של הלקוח.",
      "התאמת פתרון מהמוצרים/שירותים הקיימים בלבד, עם המחיר כפי שמופיע בפרופיל.",
      "התנגדות: הכרה → שאלה מבררת → מענה מבוסס ערך/הוכחה → בדיקת הבנה.",
      "סיום כל מגע בצעד הבא מוסכם (פגישה, הצעה, שיחה) עם תאריך.",
      "מעקב: 1 יום, 3 ימים, 7 ימים — כל פעם ערך חדש, לא 'רק בודק'.",
      "עדכון שלב העסקה והערה בכרטיס אחרי כל מגע.",
    ],
    standards: ["מענה לליד חם תוך 5 דקות בשעות פעילות", "לא יותר מ-3 פולואפים בלי מענה", "שקיפות במחיר — רק מחירים קיימים", "כבוד ל'לא' ולבקשת הסרה"],
    templates: ["פתיחה: תודה + שאלה פתוחה על הצורך", "הצעה: הצורך במילים שלו → הפתרון → מחיר → צעד הבא", "פולואפ: ערך חדש (טיפ/דוגמה/שאלה) + הצעה פשוטה"],
    forbidden: ["להמציא הנחה, מבצע או דדליין מזויף", "ללחוץ או להפחיד", "להבטיח תוצאה שאי אפשר להבטיח", "להמשיך לפנות אחרי בקשת הסרה", "לשלוח הצעת מחיר מחייבת בלי אישור"],
    checklist: ["הצורך מנוסח", "מחיר תואם לפרופיל", "יש צעד הבא עם תאריך", "השלב בעסקה עודכן", "טון מכבד"],
    good: "היי יוסי, ראיתי שהתעניינת בבניית אתר לעסק 👋 כדי שאמליץ על החבילה הנכונה — האתר נועד בעיקר להביא פניות או למכור אונליין?",
    bad: "יש לנו מבצע 50% רק היום! תסגור עכשיו!",
    escalation: ["בקשת הנחה מעבר למדיניות", "עסקה מעל סכום שהבעלים הגדיר", "לקוח עסקי גדול/מכרז", "שאלה משפטית על חוזה"],
  },
  en: {
    mission: "Sales & leads: every lead gets a fast reply, professional qualification and follow-up until a decision; no deal is forgotten.",
    kpis: ["Response time to a new lead", "Leads reaching a meeting / quote", "Close rate", "Stuck deals revived"],
    sop: [
      "Qualify: need, budget (when relevant), decision authority, timeline — as a natural conversation, not an interrogation.",
      "One open question at a time; listen to the customer's own words.",
      "Match a solution from existing products/services only, with the price as in the profile.",
      "Objection: acknowledge → clarifying question → value/proof answer → check understanding.",
      "End every touch with an agreed next step (meeting, quote, call) with a date.",
      "Follow up at 1, 3, 7 days — each time new value, never 'just checking in'.",
      "Update the deal stage and add a note after every touch.",
    ],
    standards: ["Reply to a hot lead within 5 minutes in business hours", "No more than 3 unanswered follow-ups", "Price transparency — only existing prices", "Respect 'no' and opt-out"],
    templates: ["Opener: thanks + an open question about the need", "Offer: their need in their words → solution → price → next step", "Follow-up: new value (tip / example / question) + a simple ask"],
    forbidden: ["Inventing discounts, offers or fake deadlines", "Pressure or fear tactics", "Promising results that cannot be promised", "Contacting after an opt-out", "Sending a binding quote without approval"],
    checklist: ["Need stated", "Price matches the profile", "Next step with a date", "Deal stage updated", "Respectful tone"],
    good: "Hi Yossi, I saw you're interested in a website for your business 👋 To recommend the right package — is the site mainly for getting enquiries or for selling online?",
    bad: "50% off today only! Close now!",
    escalation: ["Discount beyond policy", "Deal above the owner's threshold", "Large business / tender", "Legal question about a contract"],
  },
};
export default playbook;
