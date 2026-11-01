# צוות עובדים דיגיטלי — ארכיטקטורה

מאחורי flag `team_v1` (טבלת `feature_flags`, לעסק או לכל הפלטפורמה) **וגם** הפעלה בהגדרות הצוות של העסק. כשהם כבויים לא קורה שום דבר חדש, וכל ההתנהגות הקיימת נשארת בדיוק כמו שהייתה.

```
                ┌──────────────────────────── מסך / Server Actions (ai-team/actions.ts) ───────────────────────────┐
  הבעלים ──────▶│ מטרה · משימה · אישור/דחייה/עריכה · תשובה לשאלה · זיכרון · ספר תפקיד · עצירת חירום · שיחת בדיקה │
                └──────────────┬───────────────────────────────────────────────────────────────┬──────────────────┘
                               │                                                               │
                ┌──────────────▼──────────────┐       /api/cron/team (pg_cron, כל 5 דק')       │
                │  RUNNER (runner.ts)          │◀──────── teamTick: משימות מוכנות · יוזמה · פגישה │
                │  flag + settings + stop      │                                                │
                │  claim → engine → write back │                                                │
                └──┬────────┬─────────┬───────┘                                                │
       רישום       │        │ זיכרון   │ אישורים                                                │
 ┌────────────────▼─┐ ┌────▼──────────▼───┐ ┌──────────────────┐ ┌───────────────────────────────▼──┐
 │ REGISTRY          │ │ MEMORY             │ │ APPROVALS         │ │ ORCHESTRATION                     │
 │ roles.ts          │ │ memory-core.ts     │ │ policy-core.ts    │ │ engine-core.ts                    │
 │ playbooks/*.ts    │ │ team_memory        │ │ team_approvals    │ │ planGoal → DAG → assign (load)     │
 │ team_members      │ │ אפיזודי · סמנטי    │ │ suggest/approve/  │ │ readyTasks (תלויות) · handoff      │
 │ team_playbooks    │ │ רלוונטיות×עדכניות  │ │ auto + auto_actions│ │ isLoop · budgetStop · עומק/צעדים  │
 └──────────────────┘ │ ×ביטחון · supersede│ │ emergency_stop     │ │ team_tasks · team_messages         │
                      └────────────────────┘ └──────────────────┘ └───────────────┬───────────────────┘
                                                                                   │
              ┌────────────────────────── מחזור העבודה (runEmployeeTask) ──────────▼──────────────────────────┐
              │ 1 הבנה → 2 הקשר → 3 תכנון → 4 ביצוע → 5 בדיקה עצמית → 6 סקירת עמית → 7 מסירה/אישור → 8 סיכום+למידה │
              │ כל שלב נכתב ל-team_activity (append-only, טריגר חוסם עדכון ומחיקה)                                │
              └───────┬─────────────────────────────┬───────────────────────────────┬──────────────────────────┘
                      │                             │                               │
          ┌───────────▼──────────┐   ┌──────────────▼─────────────┐   ┌─────────────▼─────────────────────────┐
          │ SAFETY (safety-core)  │   │ MODEL ROUTING (routing-core)│   │ TOOLS (tools-core + tools.ts)          │
          │ <<<DATA>>> לתוכן חיצוני│   │ plan/review → החזק           │   │ CRM · משימות · עסקאות · Inbox · ביקורות │
          │ זיהוי injection        │   │ write/site → כתיבה/קוד       │   │ מוח הסושיאל · בונה האתרים · בדיקת אתר │
          │ חסימת דליפה · מחירים   │   │ classify → מהיר/זול          │   │ סוכני הצוות העסקי (analyst/sales/…)     │
          │ מומצאים · הסלמה לאדם  │   │ summarize → הקשר ארוך        │   │ messageContact (guard) · יומן           │
          └──────────────────────┘   │ vision → ראייה               │   │ כל שאילתה מסוננת לפי organization_id   │
                                     │ ai_routing (DB) + העדפת עסק  │   └───────────────────────────────────────┘
                                     │ ↓ runAISystem (קרדיטים קיימים)│
                                     │ ↓ generateRouted (fallback)  │
                                     └──────────────────────────────┘
```

## Playbooks (קובץ נפרד לכל תפקיד, עברית + אנגלית)
`lib/team/playbooks/`: manager, team_lead, customer_service, sales, marketing, content_writer, web_builder, analyst, project_coordinator, quality_control, collections, reputation, custom.

כל קובץ כולל: מטרה, מדדי הצלחה, SOP, סטנדרטים מקצועיים, תבניות תוצר, רשימת "אסור", צ'קליסט איכות, דוגמה טובה ודוגמה גרועה, וכללי הסלמה. הוראות שהעסק מוסיף (`team_playbooks`) נכנסות מעל הבסיס, ולעולם לא מבטלות את רשימת ה"אסור".

## מודלים מחוברים (מתוך `lib/ai/router-core.ts`, פעילים רק כשיש מפתח בסביבה)
| מודל | ספק | יכולות | פרופיל (איכות/כתיבה/קוד/מהירות) | עלות |
|---|---|---|---|---|
| openai/gpt-oss-120b, llama-3.3-70b-versatile | groq | טקסט, כלים | q4 w3 c3–4 s5 | חינמי |
| gpt-oss-120b, qwen-3.8-27b | cerebras | טקסט, כלים | q3–4 s5 | חינמי |
| gemini-3.8-flash / 3.6-flash / 3.5-flash-lite / 2.5-flash | gemini | טקסט, תמונה, כלים, הקשר ארוך | q3–4 w4 c4 s4–5 | חינמי |
| openrouter/free | openrouter | טקסט | q2 | חינמי |
| mistral-small-latest | mistral | טקסט, כלים | q3 s4 | חינמי |
| llama-3.3-70b, gpt-oss-120b, mistral-small-3.1 | cloudflare | טקסט | q2–3 | חינמי |
| gpt-4.1-mini, gpt-4o-mini, Llama-3.3-70B | github | טקסט (+תמונה ב-GPT) | q3 w4 c4 | חינמי |
| Llama-3.3-70B, gpt-oss-120b | sambanova | טקסט | q4 s5 | חינמי |
| llama-3.3-70b, gpt-oss-120b | nvidia / huggingface | טקסט | q3 | חינמי |
| claude-haiku-5-5 (ברירת מחדל) | anthropic | טקסט, תמונה, כלים, הקשר ארוך | q4 w5 c5 s4 | בתשלום (בינוני) |
| gpt-4o-mini (ברירת מחדל) | openai | טקסט, תמונה, כלים | q3 s4 | בתשלום (זול) |

ניתוב ברירת מחדל כשכל המפתחות קיימים: תכנון → gemini-3.8-flash; סקירה, כתיבה ואתרים → claude-haiku-5-5; סיווג → groq gpt-oss-120b; סיכום וראייה → gemini-3.8-flash. אם המודל הראשון נכשל, ה-router הקיים עובר אוטומטית לבא בתור, והמעבר נרשם בלוג המשימה.
