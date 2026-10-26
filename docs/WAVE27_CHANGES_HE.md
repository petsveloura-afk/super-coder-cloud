# גל 27 — תיקון חיבור Shopify / WooCommerce שלא נלחץ

**הסיבה:** בדף האינטגרציות מוגדר `form-action 'self'` ב-CSP. הדפדפן מחיל אותו גם על ההפניה שאחרי שליחת טופס, ולכן ההפניה ל-Shopify נחסמה בשקט. הכפתור נראה תקין (✓ זוהתה) אבל לא קרה כלום.

**התיקון (תוספות בלבד):**
- `components/integrations/marketplace.tsx`: Shopify ו-WooCommerce עוברים כעת בניווט רגיל (`window.location.assign`), שאינו כפוף ל-form-action. הטופס המקורי נשאר כגיבוי. נוסף מצב "מתחברים ל-Shopify…" למניעת לחיצה כפולה.
- `next.config.ts`: רשת ביטחון, בדף האינטגרציות בלבד נוסף `*.myshopify.com`, `admin.shopify.com`, `accounts.shopify.com` ל-form-action.
- תרגומים (עברית/אנגלית/ערבית): `market.shopify.connecting`.
- `tests/unit/wave27-connect.test.ts`: 3 בדיקות רגרסיה.

**אם עדיין לא עובר ל-Shopify אחרי הפריסה:** ודאו ב-Vercel ש-`SHOPIFY_CLIENT_ID` ו-`SHOPIFY_CLIENT_SECRET` מוגדרים, וב-Shopify Partners שכתובת ה-Redirect היא `https://<האפליקציה>/api/stores/shopify/callback`. אם היא שונה, Shopify יציג שגיאת redirect_uri.

## גל 28 — "שגיאה" אדומה אחרי חיבור Shopify מוצלח
- **מה קרה:** החיבור הצליח (הטוקן נשמר), אבל רישום ה-webhooks נכשל חלקית, והדף הציג תג "שגיאה" בלי סיבה.
- `lib/stores/shopify.ts`: הכשל מכיל כעת את קוד ה-HTTP והסבר Shopify לכל נושא.
- `components/integrations/marketplace.tsx`: חיבור תקין נשאר "מחובר", ומתחת מופיעה אזהרה עם הסיבה המדויקת ומה לעשות.
- `app/api/stores/shopify/sync/route.ts`: אחרי סנכרון מוצלח, תקלת webhooks נשארת גלויה כאזהרה.
- תרגומים בעברית/אנגלית/ערבית + בדיקה.
