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

## טלגרם אישי (חיבור API / סשן משתמש)
- `services/wa-bridge/src/telegram-user.mjs`:
  - **Watchdog** כל 45 שניות: חיבור שנפל, או "מת בשקט" (בדיקת ping כל 3 דקות), נבנה מחדש אוטומטית עם לקוח חדש + השלמת הודעות שהוחמצו (`catchUp`).
  - **כשל רשת בעלייה** כבר לא נחשב ניתוק: הסשן נשמר, הסטטוס "reconnecting" והחיבור נבנה מחדש. QR מוצג רק אם טלגרם עצמו אומר שהסשן בוטל, ואז נשלח גם `logged_out` ל-web.
  - **שליחה** מנסה לשקם חיבור (עד כ-12 שניות) לפני שהיא נכשלת.
  - **העברת הודעת לקוח ל-web**: עד 6 ניסיונות עם המתנה גדלה (כולל 5xx/429), במקום 3.
  - לקוח ישן נסגר לפני יצירת חדש (בלי כפילויות).
- `services/wa-bridge/src/server.mjs`: מפעיל את ה-watchdog; `/health` מציג כמה סשנים מחוברים.
- `apps/web/lib/channels/tg-user.ts`: "reconnecting" מוצג כ"מתחבר"; שליחה שנכשלה בגלל חיבור שנפל מנוסה שוב ולא נחשבת כשל סופי.
- בדיקות: `services/wa-bridge/tests/wave62-telegram.test.mjs`.
