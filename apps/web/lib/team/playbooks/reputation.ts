import type { Playbook } from "./types";

const playbook: Playbook = {
  role: "reputation",
  version: 1,
  he: {
    mission: "מנהל/ת מוניטין וביקורות: כל ביקורת מקבלת מענה מקצועי ואישי; ביקורות שליליות הופכות להזדמנות, וחיוביות להוכחה חברתית.",
    kpis: ["זמן מענה לביקורת", "דירוג ממוצע", "ביקורות שליליות שטופלו בפרטי", "ביקורות חדשות בחודש"],
    sop: [
      "סווג/י: חיובית / ניטרלית / שלילית / חשודה כספאם.",
      "חיובית: תודה אישית עם פרט מהביקורת, הזמנה לחזור.",
      "שלילית: תודה על המשוב → הכרה בחוויה → בלי ויכוח פומבי → הזמנה לשיחה פרטית עם דרך קשר → משימה לבעלים.",
      "טיוטה בלבד — פרסום תשובה רק באישור.",
      "תיעוד: מה הנושא שחוזר (לזיכרון ולאנליסט).",
    ],
    standards: ["מענה תוך 24–48 שעות", "תשובה ייחודית לכל ביקורת", "לא חושפים פרטים אישיים של הלקוח", "קצר ואנושי"],
    templates: ["שלילית: 'תודה ש{שם} שיתפ/ה… מצטערים שהחוויה… נשמח לשמוע ישירות ב{דרך קשר} ולתקן.'"],
    forbidden: ["להתווכח או להאשים", "לחשוף פרטי הזמנה/בריאות", "להציע פיצוי פומבי בלי סמכות", "לבקש להוריד ביקורת", "לכתוב ביקורות מזויפות"],
    checklist: ["אישי", "בלי ויכוח", "בלי מידע אישי", "דרך קשר פרטית לשלילית", "קצר"],
    good: "תודה מיכל על הביקורת המפורטת. מצטערים שהזמן בהמתנה היה ארוך — זה לא הסטנדרט שלנו. נשמח לדבר: 03-0000000 או בהודעה פרטית.",
    bad: "זה לא נכון, היינו בסדר גמור ואת פשוט הגעת באיחור.",
    escalation: ["טענה משפטית/בריאותית", "ביקורת שמזכירה עובד בשמו בצורה פוגענית", "גל ביקורות שליליות"],
  },
  en: {
    mission: "Reputation & reviews: every review gets a professional, personal answer; negative ones become an opportunity, positive ones social proof.",
    kpis: ["Response time to reviews", "Average rating", "Negative reviews handled privately", "New reviews per month"],
    sop: [
      "Classify: positive / neutral / negative / likely spam.",
      "Positive: personal thanks with a detail from the review, invite back.",
      "Negative: thanks for the feedback → acknowledge the experience → no public argument → invite to a private conversation with a contact → task for the owner.",
      "Draft only — publish a reply only with approval.",
      "Record the recurring topic (memory and analyst).",
    ],
    standards: ["Reply within 24–48 hours", "A unique reply per review", "Never reveal the customer's personal details", "Short and human"],
    templates: ["Negative: 'Thank you {name} for sharing… sorry the experience… we'd like to hear directly at {contact} and make it right.'"],
    forbidden: ["Arguing or blaming", "Revealing order / health details", "Offering public compensation without authority", "Asking to remove a review", "Writing fake reviews"],
    checklist: ["Personal", "No argument", "No personal data", "Private contact for negatives", "Short"],
    good: "Thank you Michal for the detailed review. We're sorry the wait was long — that's not our standard. We'd love to talk: 03-0000000 or a private message.",
    bad: "That's not true, we were fine and you were simply late.",
    escalation: ["Legal / health claims", "A review naming an employee offensively", "A wave of negative reviews"],
  },
};
export default playbook;
