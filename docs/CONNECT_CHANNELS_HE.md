# חיבור ערוצים וסוכן AI שעונה ללקוחות (גל 6)

## איך זה עובד אצל הלקוח שלך (בעל העסק)
1. נכנס ל**סוכני AI** ולוחץ **"צרו סוכן מוכן בלחיצה"**, או בוחר תבנית (מכירות, תורים, שירות, נדל״ן, חנות) ומעדכן מחירים ושעות.
2. נכנס ל**אינטגרציות** ומחבר ערוץ בלחיצה.
3. זהו. הסוכן עונה ללקוחות לבד, 24/7:
   - כל שיחה נכנסת ל**תיבת ההודעות**.
   - טלפון ומייל שהלקוח כותב נשמרים באנשי הקשר.
   - כשלקוח מבקש נציג, כועס, מבקש החזר, או כשהסוכן לא יודע, השיחה עוברת לצוות עם התראה ("ממתין לנציג").
   - כשמישהו מהצוות עונה מתיבת ההודעות, הסוכן מפסיק לענות בשיחה הזו. הכפתור **"החזרה לסוכן"** מחזיר אותו.

## מה עובד מיד, בלי שום הגדרה שלך

| ערוץ | מה הלקוח עושה |
|---|---|
| **צ׳אט באתר** | כלום. בועת הצ׳אט מופיעה בכל אתר ודף נחיתה שנבנה במערכת ובפורטל העזרה. לאתר חיצוני מדביקים שורת קוד אחת מדף האינטגרציות. |
| **Telegram** | יוצר בוט ב-@BotFather (דקה, בחינם), מדביק את ה-Token ולוחץ "חיבור". |
| **מייל (כל ספק)** | מדביק כתובת וסיסמת אפליקציה. השרתים של Gmail, Outlook, Yahoo, iCloud ו-Zoho מזוהים אוטומטית. |
| **קישור וואטסאפ (wa.me)** | מקליד מספר ומקבל קישור לאתר, לאינסטגרם ולמודעות. |

מיילים נקראים כל 5 דקות (GitHub Actions). אם תפעיל את שירות ה-QR למטה עם `CRON_SECRET`, הם ייקראו כל דקה.

---

## הגדרות חד-פעמיות שלך (בעל הפלטפורמה), כל אחת לא חובה

### 1) וואטסאפ בסריקת QR: שירות ב-Railway (כ-10 דקות)
1. Railway ← **New Project** ← **Deploy from GitHub repo** ← בוחרים `super-coder-cloud`.
2. Settings ← **Root Directory** = `services/wa-bridge`.
3. **Variables:**
   - `WA_BRIDGE_SECRET` = סיסמה ארוכה אקראית (לפחות 24 תווים)
   - `APP_URL` = `https://super-coder-cloud.vercel.app`
   - `CRON_SECRET` = אותו ערך שיש ב-Vercel
4. **Volumes** ← Add Volume ← Mount path: `/data`. כאן נשמרים החיבורים, כדי שלא יתנתקו בכל עדכון.
5. **Networking** ← Generate Domain ← מעתיקים את הכתובת.
6. ב-Vercel ← Environment Variables מוסיפים:
   - `WA_BRIDGE_URL` = הכתובת משלב 5
   - `WA_BRIDGE_SECRET` = אותה סיסמה משלב 3
   - ואז Redeploy.

⚠️ זה חיבור לא רשמי, ווואטסאפ עלולה לחסום מספרים שמשתמשים בו (במיוחד בהודעות המוניות). המערכת מציגה את האזהרה הזו ללקוח.

### 2) וואטסאפ רשמי בלחיצה (Meta Embedded Signup)
דורש שתהיה **Tech Provider** של Meta. ההרשמה בחינם, אבל לוקחת כמה ימים לאישור.
1. ב-developers.facebook.com ← **Create App** ← סוג **Business** ← מוסיפים את המוצרים **WhatsApp** ו-**Facebook Login for Business**.
2. מאמתים את העסק ב-Business Manager (Business Verification) ומשלימים את ההרשמה כ-Tech Provider.
3. Facebook Login for Business ← **Configurations** ← **Create** ← בוחרים "WhatsApp Embedded Signup" ומסמנים את המוצרים. גרסה 4 נקבעת אוטומטית. מעתיקים את ה-**Configuration ID**.
4. Facebook Login for Business ← Settings: מפעילים Client OAuth, Web OAuth, Enforce HTTPS, Login with the JavaScript SDK. ב-Allowed domains מוסיפים `super-coder-cloud.vercel.app`.
5. WhatsApp ← Configuration ← **Webhook**:
   - Callback URL: `https://super-coder-cloud.vercel.app/api/channels/meta/whatsapp`
   - Verify token: מחרוזת אקראית שתבחר
   - מסמנים **messages** ו-**account_update**.
6. ב-Vercel מוסיפים: `META_APP_ID`, `META_APP_SECRET` (App settings ← Basic), `META_WA_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`, ואז Redeploy.

עד שזה מוגדר, בכרטיס הרשמי כתוב "יופעל בקרוב", והחיבור הידני (מתקדם) ממשיך לעבוד.

### 3) "התחברות עם Google" למייל
1. console.cloud.google.com ← פרויקט חדש ← **APIs & Services** ← OAuth consent screen (External).
2. Credentials ← **Create OAuth client ID** ← Web application.
   - Authorized redirect URI: `https://super-coder-cloud.vercel.app/api/oauth/google/callback`
3. ב-Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, ואז Redeploy.

עד שהאפליקציה מאומתת אצל Google, אפשר להוסיף עד 100 משתמשי בדיקה, והם יראו אזהרת "אפליקציה לא מאומתת". האימות המלא של Google לגישה למייל כולל בדיקת אבטחה. בינתיים, כל לקוח יכול לחבר Gmail עם סיסמת אפליקציה.

### 4) "התחברות עם Microsoft" (Outlook / Office 365)
1. entra.microsoft.com ← App registrations ← **New registration** ← Accounts in any organizational directory and personal Microsoft accounts.
   - Redirect URI (Web): `https://super-coder-cloud.vercel.app/api/oauth/microsoft/callback`
2. Certificates & secrets ← New client secret.
3. API permissions ← Add ← **Office 365 Exchange Online** / `IMAP.AccessAsUser.All`, `SMTP.Send`, ובנוסף `offline_access`, `email`, `openid`.
4. ב-Vercel: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, ואז Redeploy.

---

## שפה
מעכשיו, ביקור ראשון נפתח בעברית גם בטלפון שהשפה שלו אנגלית (מי שהדפדפן שלו בערבית מקבל ערבית). זה מונע את "התרגום האוטומטי" המשובש של iPhone ו-Chrome. אנגלית עדיין זמינה בבורר השפה. כדי לחזור לבחירה לפי הדפדפן: `NEXT_PUBLIC_LOCALE_NEGOTIATION=browser`.
