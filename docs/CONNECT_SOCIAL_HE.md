# חיבור פייסבוק, אינסטגרם, גוגל וחנויות: הגדרה חד-פעמית של בעל הפלטפורמה

אחרי ההגדרה הזו, כל עסק במערכת מתחבר בלחיצה אחת בעמוד **חיבורים ← מרכז החיבורים**. לא צריך להעתיק טוקנים.

## 1. פייסבוק + אינסטגרם (מסנג'ר, אינסטגרם דיירקט, תגובות ופרסום)
משתמשים באותה אפליקציית Meta של וואטסאפ.

1. ב-[developers.facebook.com](https://developers.facebook.com) ← האפליקציה ← **Add product**:
   - **Messenger**
   - **Instagram** (Messenger API for Instagram)
   - **Facebook Login for Business**
2. **Facebook Login for Business ← Configurations ← Create**. מסמנים את ההרשאות:
   - `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement`, `pages_manage_posts`, `business_management`
   - `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`

   מעתיקים את ה-**Configuration ID** ל-Vercel בשם `META_PAGES_CONFIG_ID`.
3. **Webhooks**:
   - Object **Page**: Callback `https://הדומיין-שלך/api/channels/meta/pages`, Verify token כמו `META_WEBHOOK_VERIFY_TOKEN`. שדות: `messages`, `messaging_postbacks`, `message_echoes`, `feed`.
   - Object **Instagram**: אותו Callback. שדות: `messages`, `comments`.
4. כדי שעסקים שאינם מנהלי האפליקציה יוכלו להתחבר, צריך לעבור **App Review** על ההרשאות שלמעלה (Advanced Access).

## 2. וואטסאפ עסקי עם אותו מספר (Coexistence)
הכפתור "לחבר את המספר מהאפליקציה" משתמש באותה הגדרת Embedded Signup (`META_WA_CONFIG_ID`). צריך לוודא שבהגדרת ה-Embedded Signup באפליקציה מופעל **WhatsApp Business app onboarding**.

## 3. גוגל בלחיצה (יומן + Gmail + ביקורות)
1. ב-Google Cloud Console ← Credentials ← ה-OAuth Client הקיים ← **Authorized redirect URIs** מוסיפים `https://הדומיין-שלך/api/google/callback`.
2. ב-APIs & Services מפעילים:
   - Google Calendar API
   - Gmail API
   - My Business Account Management API
   - My Business Business Information API
   - Google My Business API (v4, לביקורות)

   הגישה ל-Business Profile API דורשת אישור של גוגל (טופס בקשה).
3. מסך ההסכמה (OAuth consent screen) צריך לכלול את הסקופים `calendar.events`, `calendar.freebusy`, `https://mail.google.com/` ו-`business.manage`. בשביל Gmail צריך אימות אפליקציה אצל גוגל.

## 4. Shopify
1. ב-[partners.shopify.com](https://partners.shopify.com) יוצרים אפליקציה:
   - App URL: `https://הדומיין-שלך/he/integrations`
   - Redirect: `https://הדומיין-שלך/api/stores/shopify/callback`
2. ב-Vercel מגדירים `SHOPIFY_CLIENT_ID` ו-`SHOPIFY_CLIENT_SECRET`.
3. Compliance webhooks (חובה באפליקציה ציבורית): `https://הדומיין-שלך/api/stores/shopify/webhook`.

## 5. WooCommerce
אין מה להגדיר. העסק מקליד את כתובת החנות ומאשר ב-WooCommerce. המפתחות וה-Webhooks נוצרים אוטומטית.

## 6. Zapier / Make / n8n
אין מה להגדיר. העסק יוצר מפתח API עם הרשאת "Webhooks מיידיים" ומדביק אותו. אפשר להשתמש בכתובות:
- `POST /api/public/v1/hooks` עם `{ target_url, event }` להרשמה.
- `DELETE /api/public/v1/hooks/{id}` לביטול.
- `GET /api/public/v1/events` לטריגרים במשיכה.
- `/api/public/v1/contacts`, `/deals`, `/tasks` לפעולות.

## מהירות
בניהול הפלטפורמה ← **מהירות התגובה** רואים את אזור השרת, את זמן התגובה של מסד הנתונים, ואת זמני התגובה האמיתיים של הסוכן. אם זמן התגובה של מסד הנתונים גבוה מ-60ms, צריך להעביר ב-Vercel את אזור הפונקציות (Settings → Functions → Region) לאזור של Supabase.
