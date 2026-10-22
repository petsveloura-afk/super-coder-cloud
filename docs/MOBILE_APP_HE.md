# אפליקציה לנייד: מה יש היום ואיך מגיעים לחנויות

## מה עובד כבר עכשיו, בלי חנות אפליקציות

SUPER CODER CLOUD היא **PWA**, כלומר אתר שמתנהג כמו אפליקציה:

- **התקנה למסך הבית:**
  - **אנדרואיד (Chrome):** תפריט ⋮ → "התקנת אפליקציה".
  - **iPhone (Safari):** כפתור שיתוף → "הוסף למסך הבית".
- נפתחת במסך מלא, עם אייקון משלה ומסך "אין חיבור" כשאין אינטרנט.
- **התראות Push לטלפון ולמחשב (wave 17):** בהגדרות → "התראות בטלפון ובמחשב" → "הפעלה". כל התראה במערכת מגיעה גם לטלפון: ליד חדש, תזכורת משימה, פגישה, העברה לנציג ועוד.
  - **iPhone:** ההתראות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית (iOS 16.4 ומעלה).
  - **הגדרה חד-פעמית בשרת:** מריצים `node scripts/setup/generate-vapid.mjs`, ומכניסים ל-Vercel את `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` ו-`VAPID_SUBJECT`.
- כל המסכים מותאמים לנייד: תיבת ההודעות, CRM, משימות, יומן והצעות מחיר.

## למה אין עדיין אפליקציה ב-App Store / Google Play

פרסום בחנויות דורש **חשבונות מפתח על שמך**. אי אפשר ליצור אותם מהקוד:

| חנות | מה צריך | עלות |
| --- | --- | --- |
| Google Play | Google Play Console | ‎25$‎, תשלום חד-פעמי |
| Apple App Store | Apple Developer Program, ומחשב Mac לבנייה (או שירות בנייה בענן) | ‎99$‎ לשנה |

## הדרך המומלצת: עטיפה של ה-PWA

אין צורך לכתוב אפליקציה מחדש. עוטפים את האתר הקיים, והאפליקציה מתעדכנת לבד בכל פריסה.

### אנדרואיד: TWA (Trusted Web Activity)

1. `npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest`
2. `npx @bubblewrap/cli build`. נוצר קובץ `app-release.aab`.
3. מעלים את קובץ ה-`.aab` ל-Google Play Console.
4. מוסיפים את הקובץ `/.well-known/assetlinks.json` עם טביעת האצבע שמופיעה ב-Play Console. בלי הקובץ הזה האפליקציה תציג שורת כתובת.

### iPhone: Capacitor

1. `npm i @capacitor/core @capacitor/cli @capacitor/ios`
2. `npx cap init "Super Coder Cloud" com.yourcompany.scc --web-dir=out`, ואז מגדירים ב-`capacitor.config` את `server.url` לכתובת האתר.
3. `npx cap add ios`, ואז `npx cap open ios`. משם בונים ב-Xcode ושולחים ל-App Store Connect.
4. אפל דורשת שהאפליקציה תציע יותר מ"אתר בתוך מסגרת". התראות Push ומסך כניסה מהיר עוזרים לעבור את הבדיקה.

## מה לשלוח לי כשתרצה שנעשה את זה יחד

- שם האפליקציה, אייקון בגודל 1024×1024, ותיאור קצר ומלא.
- הדומיין הסופי של המערכת.
- גישה לחשבונות המפתח, או שתבצע את ההעלאה בעצמך לפי השלבים למעלה.
