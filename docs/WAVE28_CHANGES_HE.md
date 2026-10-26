# גל 28 — "שגיאה" אדומה אחרי חיבור Shopify מוצלח

- **מה קרה:** החיבור הצליח (הטוקן נשמר), אבל רישום ה-webhooks נכשל חלקית, והדף הציג תג "שגיאה" בלי סיבה.
- `lib/stores/shopify.ts`: הכשל מכיל כעת את קוד ה-HTTP והסבר Shopify לכל נושא.
- `components/integrations/marketplace.tsx`: חיבור תקין נשאר "מחובר", ומתחת מופיעה אזהרה עם הסיבה המדויקת ומה לעשות.
- `app/api/stores/shopify/sync/route.ts`: אחרי סנכרון מוצלח, תקלת webhooks נשארת גלויה כאזהרה.
- תרגומים בעברית/אנגלית/ערבית (`market.shopify.warn.*`) + בדיקה ב-`wave27-connect.test.ts`.

## גל 27 (הקודם) — תיקון כפתור החיבור
בדף האינטגרציות הוגדר `form-action 'self'`, והדפדפן חסם את ההפניה מהטופס אל Shopify / WooCommerce. הכפתורים עוברים עכשיו בניווט רגיל (`window.location.assign`), ובדף נוספה רשת ביטחון ב-CSP.
