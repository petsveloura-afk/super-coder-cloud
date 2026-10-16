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

---

## עדכון v8

### 5) טלגרם בחשבון האישי (לא רק בוט)
הלקוח שלך יכול לבחור: **בוט** (טוקן מ-@BotFather) או **החשבון האישי שלו** (הסוכן עונה מהמספר הפרטי, כמו "משתמש שעונה").
החיבור האישי עובר דרך אותו שירות גשר מסעיף 1 (Railway). פעם אחת אצלך:
1. נכנסים ל-my.telegram.org ← API development tools ← יוצרים אפליקציה (שם כלשהו).
2. מעתיקים `api_id` ו-`api_hash`.
3. ב-Railway, בשירות הגשר ← Variables מוסיפים:
   - `TELEGRAM_API_ID` = המספר
   - `TELEGRAM_API_HASH` = המחרוזת
4. Redeploy לשירות. בדף האינטגרציות יופיע כרטיס "טלגרם – החשבון האישי".

אצל הלקוח: לוחצים "חיבור" ← בטלפון: טלגרם ← הגדרות ← מכשירים ← **קישור מכשיר** ← סורקים את ה-QR. אם יש אימות דו-שלבי, מופיע שדה סיסמה.
הסוכן עונה רק בצ׳אטים פרטיים, לעולם לא בקבוצות או בערוצים.
⚠️ זה חשבון אמיתי. טלגרם עלולה להגביל חשבון ששולח הרבה הודעות ללא היכרות, ולכן לשיווק המוני עדיף בוט.

### 6) תשלום על החבילות: הכסף נכנס אליך
אפשר להפעיל כל שילוב. כל שיטה מופיעה בדף החיוב רק כשהמפתחות שלה מוגדרים ב-Vercel.

**PayPal: הכסף נכנס לארנק ה-PayPal שלך.** הלקוח משלם עם PayPal, או עם כרטיס אשראי בלי חשבון PayPal, היכן ש-PayPal מאפשרת את זה.
1. developer.paypal.com ← Apps & Credentials ← **Live** ← Create App ← מעתיקים Client ID ו-Secret.
2. באותה אפליקציה ← Webhooks ← Add Webhook:
   - URL: `https://super-coder-cloud.vercel.app/api/webhooks/paypal`
   - אירועים: `BILLING.SUBSCRIPTION.*` ו-`PAYMENT.SALE.COMPLETED`
   - מעתיקים את ה-Webhook ID.
3. ב-Vercel: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, ואז Redeploy. החבילות ב-PayPal נוצרות לבד בתשלום הראשון.

**Lemon Squeezy: כרטיס אשראי, Apple Pay ו-Google Pay, כולל מע״מ וחשבוניות מהם.** הם המוכר הרשמי (Merchant of Record), והתשלום אליך מגיע ל-PayPal או לבנק.
1. app.lemonsqueezy.com ← Store ← יוצרים מוצר "Pro" ו-"Business", עם Variant חודשי ושנתי כמנוי.
2. Settings ← API ← מפתח חדש. מעתיקים גם את ה-Store ID.
3. Settings ← Webhooks ← `https://super-coder-cloud.vercel.app/api/webhooks/lemonsqueezy`, עם Signing secret לבחירתך. מסמנים את אירועי `subscription_*` ואת `order_created`.
4. ב-Vercel:
   - `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`
   - `LEMONSQUEEZY_VARIANT_PRO_MONTH`, `LEMONSQUEEZY_VARIANT_PRO_YEAR`, `LEMONSQUEEZY_VARIANT_BUSINESS_MONTH`, `LEMONSQUEEZY_VARIANT_BUSINESS_YEAR` (המספר של כל Variant)
5. Payouts ← מחברים PayPal או בנק.

**קריפטו (NOWPayments): הכסף נכנס לארנק הקריפטו שלך.**
1. nowpayments.io ← הרשמה ← Wallet settings ← מגדירים את כתובת הארנק שלך (למשל USDT).
2. Settings ← API keys ← מפתח חדש. Payment settings ← IPN secret.
3. ב-Vercel: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`. כתובת ה-IPN נשלחת אוטומטית עם כל חשבונית: `/api/webhooks/nowpayments`.
4. תשלום בקריפטו משלם על תקופה מראש (חודש או שנה). 3 ימים לפני הסוף הלקוח מקבל תזכורת, ו-3 ימים אחרי הסוף החבילה חוזרת לחינם. זה רץ לבד ב-GitHub Actions.

**קבלות:** כל תשלום, מכל ספק, נרשם עם מספר קבלה רץ (מ-1001). הלקוח מקבל מייל עם קישור לקבלה להדפסה או לשמירה כ-PDF, וכל התשלומים מופיעים בדף החיוב וגם בממשק המנהל שלך. פרטי העסק שעל הקבלה: `BILLING_BUSINESS_NAME`, `BILLING_BUSINESS_ID`, `BILLING_BUSINESS_ADDRESS`, `BILLING_BUSINESS_EMAIL`.
ℹ️ זו קבלה על תשלום ולא חשבונית מס. לחשבונית מס (למשל בישראל) צריך מערכת חשבוניות מאושרת, או Lemon Squeezy שמנפיקה חשבוניות בעצמה. כדאי לבדוק עם רואה החשבון.

### 7) ניהול השיחה של הסוכן: הכול מהממשק
בדף הסוכנים, ליד כל סוכן, יש כפתור **"ניהול שיחה"**. שם בעל העסק קובע:
- **תסריט השיחה:** השלבים לפי הסדר. אפשר לטעון תסריט מוצע לפי המטרה, לשנות, למחוק ולהזיז עם חצים.
- **מה חייבים לברר** לפני סגירת הליד (למשל גודל הכלב או תאריך).
- **מחירים ומיקוח:** הסוכן מתמקח רק במסגרת הזו ולעולם לא יורד ממנה.
- **קישורים** שהסוכן שולח (אתר, קטלוג, תשלום).
- **כפתורי תפריט:** מופיעים בטלגרם ב-Start וב-/menu, ובצ׳אט באתר. בטלגרם נוספים גם תפריט פקודות (/prices, /book, /human) ותיאור הבוט, אוטומטית לכל מי שמחבר טוקן.
- **גלריית דוגמאות:** מעלים תמונות. כשלקוח מבקש דוגמאות, הסוכן שולח את המתאימות.

**כשה-AI עמוס:** הסוכן מחכה עד 45 שניות ומנסה שוב, ומנסה גם ספק AI אחר אם הוגדר. אם עדיין אין תשובה, הלקוח מקבל "קיבלתי, אחזור אליך תוך רגע", השיחה **נשארת אצל הסוכן**, ותוך 1–5 דקות הסוכן עונה לבד. אין יותר "נציג יחזור אליך" שעוצר את השיחה.
כדי למנוע עומס בחינם: אפשר להוסיף כמה מפתחות Gemini ב-Vercel (`GEMINI_API_KEY_2` עד `GEMINI_API_KEY_10`, כל אחד מחשבון Google אחר), או `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` כגיבוי.

---

## עדכון v9: נתב AI (הסוכן לא נתקע יותר)

### מה השתנה
- **בעבר:** כל הודעה ניסתה שוב ושוב את אותו Gemini. במכסה חינמית של כ-10 בקשות לדקה (לכל הפרויקט, לא לכל מפתח), הניסיונות עצמם יצרו את ה"עומס".
- **עכשיו:** כל מפתח ומודל נוסה פעם אחת. מה שנחסם "נח" בדיוק כמה שצריך (דקה, עד חצות קליפורניה, או שעה למפתח שגוי), והסוכן עובר מיד למנוע הבא: Groq, Cerebras, Gemini, OpenRouter, Mistral, Claude, OpenAI.
- **הודעת "קיבלתי…"** נשלחת לכל היותר פעם ב-15 דקות לשיחה. כשמנוע מתפנה, הסוכן עונה באותה ריצה, בלי לחכות ל-cron.
- **בממשק המנהל** יש כרטיס **"בדיקת מנועי AI"**: לוחצים "בדיקה עכשיו" ורואים לכל מפתח אם הוא תקין, עמוס, שנגמרה לו המכסה היומית או שהוא שגוי, ומה עושים בכל מצב.

### מפתחות AI חינמיים מומלצים (דקה כל אחד, בלי כרטיס אשראי)
מומלץ לפחות שניים, מספקים שונים. מוסיפים ב-Vercel ← Settings ← Environment Variables (Production), ואז **Redeploy**.

| ספק | איפה פותחים מפתח | שם המשתנה ב-Vercel | למה |
|---|---|---|---|
| **Groq** (מומלץ ראשון) | console.groq.com ← API Keys ← Create API Key | `GROQ_API_KEY` | מהיר מאוד (תשובה בשנייה), כ-1,000 בקשות ביום למודל |
| **Cerebras** | cloud.cerebras.ai ← API Keys | `CEREBRAS_API_KEY` | מהיר מאוד, מכסה חינמית נפרדת |
| **Google Gemini** | aistudio.google.com ← Get API key. **כל מפתח בפרויקט נפרד** | `GEMINI_API_KEY`, `GEMINI_API_KEY_2`… | איכות טובה בעברית |
| **OpenRouter** | openrouter.ai ← Keys ← Create | `OPENROUTER_API_KEY` | מודלים חינמיים (כ-50 בקשות ביום), גיבוי טוב |
| **Mistral** | console.mistral.ai ← API Keys (תוכנית Experiment החינמית) | `MISTRAL_API_KEY` | גיבוי נוסף |

אפשר להוסיף כמה מפתחות מכל ספק: `GROQ_API_KEY_2`, `CEREBRAS_API_KEY_2` וכן הלאה (עד 10).
מפתחות "ציבוריים" שמסתובבים ברשת לא מוכנסים למערכת. הם בדרך כלל גנובים, נחסמים תוך זמן קצר, ומסכנים את החשבון.

**אחרי שמוסיפים מפתחות:** Redeploy ב-Vercel, ואז בממשק המנהל ← "בדיקת מנועי AI" ← "איפוס חסימות" ← "בדיקה עכשיו". צריך לראות ✓ ליד כל מפתח.
