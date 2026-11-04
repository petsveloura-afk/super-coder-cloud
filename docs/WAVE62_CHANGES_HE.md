# שינויים – גל 62 (אמינות סוכנים ועובדי AI)

כל השינויים תוספתיים. לא נמחק ולא שונה שום דבר קיים. typecheck נקי, 1257 בדיקות עוברות, בדיקת עקביות תרגומים עוברת.

1. `app/api/bridge/tick/route.ts` – הדופק של 30 שניות מפעיל גם את שעון צוות ה-AI, את סוכני ה-cron ואת ה-watchdog של שיחות תקועות. עד כה אלה רצו רק מ-GitHub Actions שמתעכב לפעמים שעות.
2. `lib/ops/job-runs.ts` – `runLockedJob`: אותה נעילת DB של ה-cron, כך שדופק וגם GitHub לא רצים במקביל.
3. `services/wa-bridge/src/server.mjs` – ה-bridge קורא גם ל-`/api/cron/team` ו-`/api/cron/agents` (כל 2–3 דקות).
4. `lib/ai/autopilot.ts` – כשמנועי AI עמוסים, ניסיונות שקטים (עם "מקליד…") לפני כל הודעת "אני על זה" מוכנה. הלקוח מקבל מענה AI אמיתי.
5. `lib/team/model-health-core.ts` – מצב בריאות ישן שנשמר מהבאג `fallback_used` מתנקה; "בבדיקה" שאף אחד לא בדק 20 דקות חוזר ל"תקין"; מיפוי שגיאות גולמיות לסיבה קריאה.
6. `components/ai-team/health-panel.tsx` + מילוני he/en/ar – במקום `fallback_used` / `ai.failed` מוצגת סיבה בעברית.
7. `lib/team/tool-failure-core.ts` – שגיאות של מנועי AI (עמוס, תשובה ריקה) מסווגות "תקלה זמנית" שנוסית שוב לבד, ולא "שגיאה לא צפויה" או "חסר נתון".
8. בדיקות חדשות: `tests/unit/wave62-reliability.test.ts`.
