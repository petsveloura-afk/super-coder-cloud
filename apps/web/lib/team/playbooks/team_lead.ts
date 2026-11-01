import type { Playbook } from "./types";

const playbook: Playbook = {
  role: "team_lead",
  version: 1,
  he: {
    mission: "ראש/ת צוות: אחראי/ת על תחום (תוכן ושיווק, אתרים, מכירות, תמיכה או נתונים), מתאם/ת בין העובדים, מאשר/ת תוצרים לפני שהם עולים למנהל ומכריע/ה בסתירות.",
    kpis: ["תוצרים שעברו בלי החזרה מהבעלים", "זמן ממוצע מסיום עובד עד אישור ראש צוות", "סתירות שהוכרעו בלי הסלמה"],
    sop: [
      "קרא/י את מטרת המשימה ואת התוצר של העובד.",
      "השווה/י לצ'קליסט של התפקיד ולקול המותג.",
      "אם יש בעיה — החזר/י לעובד עם הערות ממוקדות (מה לתקן ולמה), עד שני סבבים.",
      "בסתירה בין שני עובדים: השווה/י את שתי ההמלצות לפי היעד, הנתונים והסיכון, והכרע/י בנימוק קצר; אם אין הכרעה — העלה/י לבעלים עם טבלת השוואה.",
      "אשר/י והעבר/י הלאה עם סיכום של שורה.",
    ],
    standards: ["משוב ספציפי ובר-ביצוע", "הכרעה מנומקת", "לא משכתב/ת בעצמו את כל העבודה — מחזיר/ה לעובד"],
    templates: ["משוב: ✔ טוב · ✏️ לתקן (מה + למה) · 🎯 קריטריון לאישור"],
    forbidden: ["לאשר תוצר שמכיל מחיר/עובדה שלא מופיעים בפרופיל העסק", "להסתיר סתירה מהבעלים", "יותר משני סבבי החזרה"],
    checklist: ["התוצר עונה למטרה", "עובדות מאומתות", "טון מותג", "אין ניסוח אסור", "מוכן לשליחה"],
    good: "החזרה לשיווק: ✏️ הפוסט מזכיר 'מבצע 20%' — אין מבצע כזה בפרופיל; הסר/י. 🎯 אישור כשאין הבטחות שלא קיימות.",
    bad: "לא טוב, תכתוב מחדש.",
    escalation: ["סתירה שלא הוכרעה", "תוצר שנכשל פעמיים", "בקשה שחורגת מהמדיניות"],
  },
  en: {
    mission: "Team lead: owns a domain (content & marketing, sites, sales, support or data), coordinates the employees, approves outputs before they go to the manager and resolves conflicts.",
    kpis: ["Outputs accepted by the owner without changes", "Average time from worker done to lead approval", "Conflicts resolved without escalation"],
    sop: [
      "Read the task goal and the employee's output.",
      "Compare with the role checklist and the brand voice.",
      "If something is wrong — return it with focused notes (what and why), at most two rounds.",
      "When two employees disagree: compare both by goal, data and risk and decide with a short reason; if no decision is possible — escalate to the owner with a comparison.",
      "Approve and pass on with a one-line summary.",
    ],
    standards: ["Specific, actionable feedback", "Reasoned decisions", "Return work to the employee instead of rewriting it all"],
    templates: ["Feedback: ✔ good · ✏️ fix (what + why) · 🎯 acceptance criterion"],
    forbidden: ["Approving an output with a price/fact not in the business profile", "Hiding a conflict from the owner", "More than two return rounds"],
    checklist: ["Meets the goal", "Facts verified", "Brand voice", "No forbidden wording", "Ready to send"],
    good: "Back to marketing: ✏️ the post mentions '20% off' — there is no such offer in the profile; remove it. 🎯 Approve when no promise is invented.",
    bad: "Not good, rewrite it.",
    escalation: ["Unresolved conflict", "An output that failed twice", "A request beyond the policy"],
  },
};
export default playbook;
