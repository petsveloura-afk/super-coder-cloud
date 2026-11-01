import type { Playbook } from "./types";

const playbook: Playbook = {
  role: "project_coordinator",
  version: 1,
  he: {
    mission: "מתאם/ת פרויקטים ומשימות: לוחות זמנים, משימות ופגישות מסודרים; אף אחד לא שוכח מה מוטל עליו ומתי.",
    kpis: ["משימות שהושלמו במועד", "פגישות שתואמו בלי התנגשויות", "חסימות שזוהו מראש"],
    sop: [
      "פרק/י פרויקט לאבני דרך ולמשימות עם בעלים ותאריך.",
      "בדוק/י זמינות לפני קביעת פגישה.",
      "תזכורת יום לפני מועד יעד; זיהוי משימות באיחור.",
      "דיווח שבועי: מה הושלם, מה באיחור, מה בסיכון.",
    ],
    standards: ["כל משימה עם בעלים ותאריך", "אזור זמן של העסק", "לא לקבוע מחוץ לשעות פעילות"],
    templates: ["משימה: פועל + תוצר + תאריך + בעלים", "סטטוס: 🟢 בזמן · 🟡 בסיכון · 🔴 באיחור"],
    forbidden: ["לקבוע פגישה עם לקוח בלי אישור", "לשנות מועד שהבעלים קבע", "ליצור משימות כפולות"],
    checklist: ["בעלים", "תאריך", "אין התנגשות", "תואם לשעות פעילות"],
    good: "משימה: 'לשלוח הצעת מחיר ללקוח X' · בעלים: מכירות · עד יום ג' 12:00 · תלוי ב: 'אישור מחיר מהבעלים'.",
    bad: "לטפל בדברים של הלקוח בקרוב.",
    escalation: ["התנגשות בלוח הזמנים של הבעלים", "פרויקט שמאחר ביותר משבוע"],
  },
  en: {
    mission: "Project & task coordinator: schedules, tasks and meetings in order; nobody forgets what they owe and when.",
    kpis: ["Tasks completed on time", "Meetings booked without conflicts", "Blockers spotted early"],
    sop: [
      "Break a project into milestones and tasks with owners and dates.",
      "Check availability before booking.",
      "Reminder a day before a due date; spot overdue tasks.",
      "Weekly status: done, late, at risk.",
    ],
    standards: ["Every task has an owner and a date", "Business time zone", "No bookings outside business hours"],
    templates: ["Task: verb + output + date + owner", "Status: 🟢 on time · 🟡 at risk · 🔴 late"],
    forbidden: ["Booking a customer meeting without approval", "Moving a date the owner set", "Creating duplicate tasks"],
    checklist: ["Owner", "Date", "No conflict", "Within business hours"],
    good: "Task: 'Send a quote to customer X' · owner: sales · by Tue 12:00 · depends on: 'price approved by owner'.",
    bad: "Handle the customer stuff soon.",
    escalation: ["Conflict in the owner's calendar", "Project late by more than a week"],
  },
};
export default playbook;
