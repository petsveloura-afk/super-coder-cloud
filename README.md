# SUPER CODER CLOUD

פלטפורמת SaaS רב-דיירית לעסקים: CRM, אוטומציה, AI וניהול עסקי — בעברית (RTL) כברירת מחדל, עם ערבית ואנגלית.

> **סטטוס:** כל המודולים פעילים (CRM, תיבת הודעות מרובת ערוצים כולל קולי, אוטומציות, AI, כספים, אתרים, שיווק ועוד) — ראו [`BUILD_STATUS.md`](BUILD_STATUS.md).
> (שלב 1 הושלם תחילה: תשתית + CRM אנשי קשר + צוות והרשאות.)
> פירוט כן ומלא: [`BUILD_STATUS.md`](BUILD_STATUS.md).

## סטאק
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5.9 · Tailwind CSS 4 · Radix UI · Recharts · Zod 4 ·
Supabase (Postgres + Auth + Storage + RLS) · pnpm + Turborepo · Vitest · Playwright + axe-core.

## מבנה
```
apps/web        אפליקציית Next.js (פריסה ל-Vercel, Root Directory = apps/web)
apps/worker     תהליך רקע ארוך-טווח (Railway/Fly/Render — לא Vercel)
packages/shared הרשאות (מקור אמת יחיד), ולידציות Zod, env, קריפטו
packages/database טיפוסי שורות + harness לבדיקות RLS על Postgres אמיתי
packages/config tsconfig בסיסי
supabase/       מיגרציות, seed, config.toml
scripts/        הגדרה ובדיקות (env, הרשאות, אייקונים, super admin)
docs/           תיעוד מלא
```

## התחלה מהירה (מקומי)
```bash
# דרישות: Node 22.18+, pnpm 10, Docker (עבור Supabase CLI)
pnpm install
npx supabase start                      # מעלה Postgres/Auth/REST מקומיים ומחיל מיגרציות
cp .env.local.example apps/web/.env.local   # והדביקו anon key + service role key מהפלט
pnpm check:env
pnpm dev                                # http://localhost:3000 → /he
```

## בדיקות
```bash
pnpm typecheck && pnpm lint
pnpm test                               # יחידה + RLS (מדלג על DB אם DATABASE_ADMIN_URL לא מוגדר)
pnpm test:db                            # RLS ובידוד דיירים מול Postgres של supabase start
pnpm build
pnpm test:e2e                           # דורש אפליקציה רצה + Supabase מקומי
```

## תיעוד
[ארכיטקטורה](docs/ARCHITECTURE.md) · [התקנה](docs/INSTALLATION.md) · [פריסה](docs/DEPLOYMENT.md) · [משתני סביבה](docs/ENVIRONMENT.md) ·
[מסד נתונים](docs/DATABASE.md) · [API](docs/API.md) · [אבטחה](docs/SECURITY.md) · [אינטגרציות](docs/INTEGRATIONS.md) ·
[מדריך משתמש](docs/USER_GUIDE_HE.md) · [מדריך מנהל](docs/ADMIN_GUIDE.md) · [בדיקות](docs/TESTING.md) · [פתרון תקלות](docs/TROUBLESHOOTING.md)

© Super Coder — supercoder.agency
