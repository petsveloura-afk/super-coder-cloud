/**
 * Upgrade 8 / stage B2 — the default standard operating procedures (pure data): three per department, in Hebrew / English / Arabic.
 * They are the starting point only: the owner's edit becomes a new stored VERSION (the default itself is never changed or deleted).
 * Every default keeps the platform's approval rules: anything a customer sees, money or irreversible still waits for the owner.
 */
import type { DeptKey, Lang } from "./departments-core";

export interface SopText {
  title: string;
  purpose: string;
  /** words / phrases that make the procedure the right one for a task (matched with Hebrew / Arabic prefixes handled) */
  trigger: string;
  steps: string[];
  success_metric: string;
  escalation: string;
  approvals: string[];
}
export interface DefaultSop {
  key: string;
  dept: DeptKey;
  owner_role: string;
  text: Record<Lang, SopText>;
}

export const DEFAULT_SOPS: DefaultSop[] = [
  /* ---------------------------------------------------------------- sales */
  {
    key: "sales_new_lead",
    dept: "sales",
    owner_role: "sales",
    text: {
      he: { title: "טיפול בליד חדש", purpose: "להגיב לליד חדש מהר ולהכניס אותו לצנרת המכירות.", trigger: "ליד חדש פנייה חדשה מתעניין לקוח פוטנציאלי הצעה ראשונה", steps: ["לבדוק בכרטיס איש הקשר אם הוא כבר קיים ומה ההיסטוריה שלו", "לנסח תשובה ראשונה קצרה ולשאול שאלה אחת שמקדמת את העסקה", "לפתוח עסקה בשלב הראשון ולרשום הערה על מה שנאמר", "לקבוע משימת מעקב לפי המועד שהוסכם"], success_metric: "מענה ראשון תוך 30 דקות בשעות העבודה", escalation: "ליד גדול במיוחד, בקשת הנחה או לקוח מתוסכל: להעביר לראש מחלקת מכירות", approvals: ["שליחת הודעה ללקוח", "כל הנחה"] },
      en: { title: "Handling a new lead", purpose: "Answer a new lead fast and put it into the sales pipeline.", trigger: "new lead new inquiry prospect interested potential customer first quote", steps: ["Check the contact card: is the person already known and what is the history", "Draft a short first reply with ONE question that moves the deal forward", "Open a deal in the first stage and note what was said", "Create a follow-up task for the agreed time"], success_metric: "First reply within 30 minutes during working hours", escalation: "Unusually large lead, a discount request or an upset customer: hand to the head of sales", approvals: ["Sending a message to the customer", "Any discount"] },
      ar: { title: "التعامل مع عميل محتمل جديد", purpose: "الرد بسرعة على العميل المحتمل الجديد وإدخاله في مسار المبيعات.", trigger: "عميل محتمل جديد استفسار جديد مهتم عرض أول", steps: ["فحص بطاقة جهة الاتصال: هل هو معروف وما تاريخه", "صياغة رد أول قصير مع سؤال واحد يدفع الصفقة للأمام", "فتح صفقة في المرحلة الأولى وتسجيل ملاحظة بما قيل", "إنشاء مهمة متابعة في الموعد المتفق عليه"], success_metric: "رد أول خلال 30 دقيقة في ساعات العمل", escalation: "عميل كبير جدا أو طلب خصم أو عميل غاضب: التحويل إلى رئيس قسم المبيعات", approvals: ["إرسال رسالة للعميل", "أي خصم"] },
    },
  },
  {
    key: "sales_quote",
    dept: "sales",
    owner_role: "sales",
    text: {
      he: { title: "הצעת מחיר ללקוח", purpose: "להכין הצעת מחיר נכונה על בסיס המחירים המאושרים בלבד.", trigger: "הצעת מחיר מחיר הצעה תמחור כמה עולה הערכת עלות", steps: ["לשלוף את המחירים והמדיניות מהעובדות העסקיות המאושרות", "אם מחיר חסר או לא מאושר: לא לנחש, לשאול את הבעלים", "להכין טיוטה עם פירוט, תוקף ותנאים", "להעביר לאישור הבעלים לפני שליחה"], success_metric: "הצעה נשלחת תוך יום עבודה אחד מהבקשה", escalation: "בקשה למחיר מיוחד או לכמות גדולה: לראש מחלקת מכירות ולבעלים", approvals: ["שליחת הצעה ללקוח", "מחיר שאינו ברשימה"] },
      en: { title: "Quote for a customer", purpose: "Prepare a correct quote using approved prices only.", trigger: "quote price proposal pricing how much cost estimate", steps: ["Pull prices and policies from the confirmed business facts", "If a price is missing or unconfirmed: do not guess, ask the owner", "Prepare a draft with itemisation, validity and terms", "Send to the owner for approval before it goes out"], success_metric: "Quote sent within one working day of the request", escalation: "Special price or large quantity request: head of sales and the owner", approvals: ["Sending a quote to the customer", "A price that is not on the list"] },
      ar: { title: "عرض سعر للعميل", purpose: "إعداد عرض سعر صحيح بالاعتماد على الأسعار المعتمدة فقط.", trigger: "عرض سعر سعر تسعير كم يكلف تقدير تكلفة", steps: ["سحب الأسعار والسياسات من الحقائق التجارية المؤكدة", "إذا كان السعر ناقصا أو غير مؤكد: لا تخمن، اسأل المالك", "إعداد مسودة مع التفصيل والصلاحية والشروط", "إرسالها لموافقة المالك قبل الإرسال"], success_metric: "إرسال العرض خلال يوم عمل واحد من الطلب", escalation: "طلب سعر خاص أو كمية كبيرة: رئيس المبيعات والمالك", approvals: ["إرسال العرض للعميل", "سعر غير موجود في القائمة"] },
    },
  },
  {
    key: "sales_stuck_deal",
    dept: "sales",
    owner_role: "sales",
    text: {
      he: { title: "מעקב אחרי עסקה תקועה", purpose: "להחיות עסקה שלא זזה, או לסגור אותה בכבוד.", trigger: "עסקה תקועה מעקב עסקה שקטה אין תגובה לא ענה חידוש קשר", steps: ["לקרוא את ההיסטוריה ולזהות מה עצר את העסקה", "לנסח הודעת מעקב קצרה עם סיבה חדשה לחזור", "אם אין מענה אחרי שני מעקבים: להעביר לסטטוס אבוד עם סיבה", "לתעד לקח בזיכרון"], success_metric: "אין עסקה פתוחה בלי פעילות יותר משבעה ימים", escalation: "עסקה בשווי גבוה: להודיע לבעלים לפני סגירה כאבודה", approvals: ["שליחת הודעת מעקב ללקוח", "סגירה כאבודה של עסקה גדולה"] },
      en: { title: "Following up a stuck deal", purpose: "Revive a deal that stopped moving, or close it gracefully.", trigger: "stuck deal follow up quiet deal no reply did not answer re-engage", steps: ["Read the history and find what stopped the deal", "Draft a short follow-up with a NEW reason to come back", "No answer after two follow-ups: mark lost with a reason", "Record the lesson in memory"], success_metric: "No open deal without activity for more than seven days", escalation: "High-value deal: tell the owner before closing it as lost", approvals: ["Sending a follow-up to the customer", "Closing a large deal as lost"] },
      ar: { title: "متابعة صفقة متوقفة", purpose: "إحياء صفقة توقفت أو إغلاقها بشكل لائق.", trigger: "صفقة متوقفة متابعة صفقة هادئة لا رد لم يرد إعادة التواصل", steps: ["قراءة التاريخ ومعرفة ما أوقف الصفقة", "صياغة رسالة متابعة قصيرة بسبب جديد للعودة", "بدون رد بعد متابعتين: تصنيفها خسارة مع السبب", "تسجيل الدرس في الذاكرة"], success_metric: "لا توجد صفقة مفتوحة بدون نشاط أكثر من سبعة أيام", escalation: "صفقة عالية القيمة: إبلاغ المالك قبل إغلاقها", approvals: ["إرسال رسالة متابعة للعميل", "إغلاق صفقة كبيرة كخسارة"] },
    },
  },
  /* ---------------------------------------------------------------- marketing */
  {
    key: "mkt_weekly_content",
    dept: "marketing",
    owner_role: "marketing",
    text: {
      he: { title: "תכנון תוכן שבועי", purpose: "לתכנן ולהכין פוסטים לשבוע על בסיס מה שעובד ועובדות אמיתיות.", trigger: "תוכן שבועי פוסט פוסטים רשת חברתית אינסטגרם פייסבוק תכנון תוכן לוח תוכן", steps: ["לבדוק ביצועי פוסטים בשבועות האחרונים ומה למד המוח החברתי", "לבחור שלושה עד חמישה נושאים מבוססי מוצרים ומחירים מאושרים", "להכין טיוטות בלבד ולצרף תמונה חינמית כשצריך", "להעביר לאישור הבעלים לפני תזמון"], success_metric: "לפחות שלוש טיוטות מוכנות עד תחילת השבוע", escalation: "תוכן שנוגע במחיר, מבצע או טענה משפטית: לאשר מול הבעלים", approvals: ["תזמון או פרסום פוסט", "כל מבצע חדש"] },
      en: { title: "Weekly content plan", purpose: "Plan and prepare the week's posts from what works and real facts.", trigger: "weekly content post posts social media instagram facebook content plan content calendar", steps: ["Check post performance of the last weeks and what the social brain learned", "Pick three to five topics grounded in confirmed products and prices", "Prepare DRAFTS only, with a free photo when needed", "Send to the owner for approval before scheduling"], success_metric: "At least three drafts ready by the start of the week", escalation: "Content about a price, a promotion or a legal claim: confirm with the owner", approvals: ["Scheduling or publishing a post", "Any new promotion"] },
      ar: { title: "خطة المحتوى الأسبوعية", purpose: "تخطيط وإعداد منشورات الأسبوع بناء على ما ينجح وحقائق حقيقية.", trigger: "محتوى أسبوعي منشور منشورات وسائل التواصل انستغرام فيسبوك خطة محتوى", steps: ["فحص أداء المنشورات في الأسابيع الأخيرة وما تعلمه الدماغ الاجتماعي", "اختيار ثلاثة إلى خمسة مواضيع مبنية على منتجات وأسعار مؤكدة", "إعداد مسودات فقط مع صورة مجانية عند الحاجة", "إرسالها لموافقة المالك قبل الجدولة"], success_metric: "ثلاث مسودات جاهزة على الأقل مع بداية الأسبوع", escalation: "محتوى عن سعر أو عرض أو ادعاء قانوني: التأكيد مع المالك", approvals: ["جدولة أو نشر منشور", "أي عرض جديد"] },
    },
  },
  {
    key: "mkt_campaign_launch",
    dept: "marketing",
    owner_role: "marketing",
    text: {
      he: { title: "השקת קמפיין", purpose: "להשיק קמפיין בצורה מבוקרת: מטרה, קהל, מסר ומדד אחד.", trigger: "קמפיין השקת קמפיין מבצע פרסום מודעה ניוזלטר דיוור", steps: ["להגדיר מטרה אחת ומדד הצלחה אחד", "להגדיר קהל והיקף נמענים", "להכין טיוטה עם מסר ברור והצעה מאושרת", "לשלוח לאישור הבעלים. הודעה לרבים לעולם לא יוצאת בלי אישור"], success_metric: "מדד ההצלחה הוגדר לפני השליחה ונמדד אחריה", escalation: "קהל מעל 20 נמענים או הצעה שאינה מאושרת: לבעלים", approvals: ["שליחת קמפיין", "הודעה לרבים"] },
      en: { title: "Launching a campaign", purpose: "Launch a campaign in a controlled way: goal, audience, message and ONE metric.", trigger: "campaign launch campaign promotion advertising ad newsletter mailing", steps: ["Define one goal and one success metric", "Define the audience and the number of recipients", "Prepare a draft with a clear message and an approved offer", "Send to the owner for approval. A message to many people never goes out without approval"], success_metric: "The success metric is defined before sending and measured after", escalation: "More than 20 recipients or an unapproved offer: the owner", approvals: ["Sending a campaign", "A message to many recipients"] },
      ar: { title: "إطلاق حملة", purpose: "إطلاق حملة بشكل منضبط: هدف وجمهور ورسالة ومقياس واحد.", trigger: "حملة إطلاق حملة عرض إعلان نشرة بريدية", steps: ["تحديد هدف واحد ومقياس نجاح واحد", "تحديد الجمهور وعدد المستلمين", "إعداد مسودة برسالة واضحة وعرض معتمد", "إرسالها لموافقة المالك. الرسالة الجماعية لا تخرج بدون موافقة"], success_metric: "تحديد مقياس النجاح قبل الإرسال وقياسه بعده", escalation: "أكثر من 20 مستلما أو عرض غير معتمد: المالك", approvals: ["إرسال حملة", "رسالة لعدد كبير من المستلمين"] },
    },
  },
  {
    key: "mkt_results_review",
    dept: "marketing",
    owner_role: "analyst",
    text: {
      he: { title: "סיכום ביצועי שיווק", purpose: "להבין מה עבד ומה לא, ולהמליץ על שינוי אחד.", trigger: "ביצועי שיווק סיכום קמפיין תוצאות קמפיין מה עבד ניתוח פוסטים החזר השקעה", steps: ["לשלוף מספרים אמיתיים מהמערכת, לא מהזיכרון", "להשוות לתקופה קודמת ולציין אם הדוגמה קטנה מדי", "לנסח מסקנה אחת והמלצה אחת", "להציע ניסוי A/B אם יש השערה, בלי להכריע בלי מדגם"], success_metric: "סיכום תוך יומיים מסוף הקמפיין", escalation: "ירידה חדה בלידים: להודיע לבעלים באותו יום", approvals: []},
      en: { title: "Marketing results review", purpose: "Understand what worked and what did not, and recommend ONE change.", trigger: "marketing performance campaign results what worked analysis posts return on investment review results", steps: ["Pull real numbers from the system, not from memory", "Compare with the previous period and say when the sample is too small", "Write one conclusion and one recommendation", "Propose an A/B experiment if there is a hypothesis, no verdict without a sample"], success_metric: "Review within two days of the campaign end", escalation: "A sharp drop in leads: tell the owner the same day", approvals: [] },
      ar: { title: "مراجعة نتائج التسويق", purpose: "فهم ما نجح وما لم ينجح والتوصية بتغيير واحد.", trigger: "أداء التسويق نتائج الحملة ما الذي نجح تحليل المنشورات عائد الاستثمار مراجعة النتائج", steps: ["سحب أرقام حقيقية من النظام وليس من الذاكرة", "المقارنة بالفترة السابقة وذكر إن كانت العينة صغيرة", "كتابة استنتاج واحد وتوصية واحدة", "اقتراح تجربة A/B عند وجود فرضية دون حكم بلا عينة كافية"], success_metric: "مراجعة خلال يومين من نهاية الحملة", escalation: "انخفاض حاد في العملاء المحتملين: إبلاغ المالك في نفس اليوم", approvals: [] },
    },
  },
  /* ---------------------------------------------------------------- service */
  {
    key: "svc_inquiry",
    dept: "service",
    owner_role: "customer_service",
    text: {
      he: { title: "מענה לפניית לקוח", purpose: "לענות ללקוח נכון ומהר, רק על בסיס עובדות מאושרות.", trigger: "פניית לקוח שאלה מענה ללקוח הודעה מלקוח תשובה ללקוח שעות פתיחה מחיר מדיניות", steps: ["לקרוא את ההודעה ואת היסטוריית הלקוח", "לחפש בעובדות העסקיות. אם אין תשובה מאושרת: לא לנחש", "לנסח תשובה קצרה בשפת הלקוח", "לרשום הערה בכרטיס ולסגור את הפנייה"], success_metric: "מענה ראשון תוך 30 דקות בשעות העבודה", escalation: "תלונה, איום משפטי או בקשת החזר: להעביר לראש מחלקת שירות", approvals: ["שליחת תשובה ללקוח אם האוטונומיה דורשת"] },
      en: { title: "Answering a customer inquiry", purpose: "Answer the customer correctly and fast, using confirmed facts only.", trigger: "customer inquiry question reply to customer customer message answer to customer opening hours price policy", steps: ["Read the message and the customer's history", "Search the business facts. No confirmed answer: do not guess", "Draft a short reply in the customer's language", "Add a note to the card and close the inquiry"], success_metric: "First reply within 30 minutes during working hours", escalation: "Complaint, legal threat or a refund request: hand to the head of customer service", approvals: ["Sending the reply when the autonomy level requires it"] },
      ar: { title: "الرد على استفسار عميل", purpose: "الرد على العميل بشكل صحيح وسريع بالاعتماد على حقائق مؤكدة فقط.", trigger: "استفسار عميل سؤال رد على العميل رسالة من عميل جواب ساعات العمل سعر سياسة", steps: ["قراءة الرسالة وتاريخ العميل", "البحث في الحقائق التجارية. لا إجابة مؤكدة: لا تخمن", "صياغة رد قصير بلغة العميل", "إضافة ملاحظة للبطاقة وإغلاق الاستفسار"], success_metric: "رد أول خلال 30 دقيقة في ساعات العمل", escalation: "شكوى أو تهديد قانوني أو طلب استرداد: التحويل إلى رئيس خدمة العملاء", approvals: ["إرسال الرد عندما يتطلب مستوى الاستقلالية ذلك"] },
    },
  },
  {
    key: "svc_complaint",
    dept: "service",
    owner_role: "customer_service",
    text: {
      he: { title: "טיפול בתלונה", purpose: "להרגיע, להבין ולפתור תלונה בלי להבטיח מה שלא אושר.", trigger: "תלונה לקוח כועס מתוסכל שירות גרוע בעיה אכזבה נזק", steps: ["להכיר בבעיה במשפט אחד ולא להתווכח", "לאסוף עובדות: מה קרה ומתי", "להציע פתרון רק בגבולות המדיניות המאושרת", "להעביר לראש מחלקת השירות כל פיצוי או החזר"], success_metric: "תלונה נפתרת או מועברת לבעלים תוך יום עבודה", escalation: "כל פיצוי כספי, איום משפטי או פגיעה בפרסום: לבעלים מיד", approvals: ["כל פיצוי או החזר", "תגובה פומבית"] },
      en: { title: "Handling a complaint", purpose: "Calm, understand and solve a complaint without promising what was not approved.", trigger: "complaint angry customer upset bad service problem disappointment damage", steps: ["Acknowledge the problem in one sentence and do not argue", "Collect facts: what happened and when", "Offer a solution only within the approved policy", "Hand any compensation or refund to the head of customer service"], success_metric: "A complaint is solved or handed to the owner within one working day", escalation: "Any monetary compensation, legal threat or public exposure: the owner at once", approvals: ["Any compensation or refund", "A public reply"] },
      ar: { title: "معالجة شكوى", purpose: "تهدئة الشكوى وفهمها وحلها دون وعد بما لم يُعتمد.", trigger: "شكوى عميل غاضب منزعج خدمة سيئة مشكلة خيبة أمل ضرر", steps: ["الاعتراف بالمشكلة بجملة واحدة وعدم الجدال", "جمع الحقائق: ماذا حدث ومتى", "اقتراح حل ضمن السياسة المعتمدة فقط", "تحويل أي تعويض أو استرداد إلى رئيس خدمة العملاء"], success_metric: "حل الشكوى أو تحويلها للمالك خلال يوم عمل", escalation: "أي تعويض مالي أو تهديد قانوني أو تشهير علني: المالك فورا", approvals: ["أي تعويض أو استرداد", "رد علني"] },
    },
  },
  {
    key: "svc_review_reply",
    dept: "service",
    owner_role: "reputation",
    text: {
      he: { title: "תגובה לביקורת", purpose: "להגיב לביקורות בגוף ענייני ומכבד, כטיוטה לאישור.", trigger: "ביקורת תגובה לביקורת גוגל דירוג כוכבים חוות דעת המלצה", steps: ["לקרוא את הביקורת ולזהות אם היא חיובית או שלילית", "לנסח טיוטת תגובה קצרה, מודה על חיובית ומתנצלת בעניין על שלילית", "לא לחשוף פרטים אישיים ולא להתווכח", "לשמור כטיוטה. הפרסום נשאר אצל האדם"], success_metric: "תגובה לכל ביקורת תוך 48 שעות", escalation: "ביקורת שקרית או מאיימת: לבעלים", approvals: ["פרסום התגובה"] },
      en: { title: "Replying to a review", purpose: "Reply to reviews in a factual, respectful voice, as a draft for approval.", trigger: "review reply to review google rating stars feedback testimonial", steps: ["Read the review and see whether it is positive or negative", "Draft a short reply: thank for a good one, apologise factually for a bad one", "Never reveal personal details and never argue", "Save as a DRAFT. Publishing stays with the person"], success_metric: "A reply to every review within 48 hours", escalation: "A false or threatening review: the owner", approvals: ["Publishing the reply"] },
      ar: { title: "الرد على تقييم", purpose: "الرد على التقييمات بأسلوب موضوعي ومحترم كمسودة للموافقة.", trigger: "تقييم رد على التقييم جوجل نجوم رأي توصية", steps: ["قراءة التقييم ومعرفة هل هو إيجابي أم سلبي", "صياغة رد قصير: شكر للإيجابي واعتذار موضوعي للسلبي", "عدم كشف تفاصيل شخصية وعدم الجدال", "الحفظ كمسودة. النشر يبقى بيد الشخص"], success_metric: "رد على كل تقييم خلال 48 ساعة", escalation: "تقييم كاذب أو تهديدي: المالك", approvals: ["نشر الرد"] },
    },
  },
  /* ---------------------------------------------------------------- operations */
  {
    key: "ops_task_intake",
    dept: "operations",
    owner_role: "project_coordinator",
    text: {
      he: { title: "קליטת משימה חדשה", purpose: "לוודא שכל משימה מגיעה לעובד הנכון עם מטרה ברורה.", trigger: "משימה חדשה קליטת משימה שיוך משימה הקצאה תיאום עדיפות", steps: ["לוודא שיש מטרה ברורה ותוצר מצופה", "לבחור עובד לפי התפקיד והעומס", "לקבוע עדיפות ומועד", "אם חסר מידע חיוני: לשאול את הבעלים שאלה אחת"], success_metric: "משימה משויכת תוך שעה מהיווצרותה", escalation: "משימה בלי בעלים מתאים: למנהל", approvals: [] },
      en: { title: "Taking in a new task", purpose: "Make sure every task reaches the right employee with a clear goal.", trigger: "new task task intake assign task assignment coordination priority", steps: ["Make sure there is a clear goal and an expected output", "Pick the employee by role and load", "Set a priority and a due time", "If essential information is missing: ask the owner ONE question"], success_metric: "A task is assigned within one hour of its creation", escalation: "A task with no fitting owner: the manager", approvals: [] },
      ar: { title: "استلام مهمة جديدة", purpose: "التأكد من وصول كل مهمة إلى الموظف المناسب بهدف واضح.", trigger: "مهمة جديدة استلام مهمة إسناد مهمة تنسيق أولوية", steps: ["التأكد من وجود هدف واضح ومخرج متوقع", "اختيار الموظف حسب الدور والعبء", "تحديد الأولوية والموعد", "إذا نقصت معلومة أساسية: اسأل المالك سؤالا واحدا"], success_metric: "إسناد المهمة خلال ساعة من إنشائها", escalation: "مهمة بلا مسؤول مناسب: المدير", approvals: [] },
    },
  },
  {
    key: "ops_quality_check",
    dept: "operations",
    owner_role: "quality_control",
    text: {
      he: { title: "בקרת איכות לפני מסירה", purpose: "לבדוק תוצר לפני שהוא יוצא ללקוח או לבעלים.", trigger: "בקרת איכות בדיקה לפני משלוח ביקורת עמיתים בדיקת תוצר הגהה בדיקת עובדות", steps: ["לבדוק עובדות, מחירים ושמות מול הנתונים המאושרים", "לבדוק שפה וטון ושאין מידע פנימי בטקסט", "לבדוק שהתוצר עונה על המטרה", "לאשר או להחזיר עם הערה אחת ברורה. עד שני סבבים"], success_metric: "אפס טעויות עובדתיות בתוצר שיצא ללקוח", escalation: "אחרי שני סבבים בלי הסכמה: לבעלים", approvals: [] },
      en: { title: "Quality check before delivery", purpose: "Check an output before it goes to a customer or the owner.", trigger: "quality check review before sending peer review output check proofreading fact check", steps: ["Check facts, prices and names against the confirmed data", "Check language, tone and that no internal information is in the text", "Check that the output answers the goal", "Approve, or return with ONE clear note. At most two rounds"], success_metric: "Zero factual errors in output that reached a customer", escalation: "After two rounds without agreement: the owner", approvals: [] },
      ar: { title: "فحص الجودة قبل التسليم", purpose: "فحص المخرج قبل وصوله إلى العميل أو المالك.", trigger: "فحص الجودة مراجعة قبل الإرسال مراجعة الزملاء فحص المخرج تدقيق لغوي تدقيق الحقائق", steps: ["فحص الحقائق والأسعار والأسماء مقابل البيانات المؤكدة", "فحص اللغة والنبرة وخلو النص من معلومات داخلية", "فحص أن المخرج يحقق الهدف", "الموافقة أو الإعادة بملاحظة واحدة واضحة. جولتان كحد أقصى"], success_metric: "صفر أخطاء واقعية في مخرج وصل إلى عميل", escalation: "بعد جولتين دون اتفاق: المالك", approvals: [] },
    },
  },
  {
    key: "ops_unblock",
    dept: "operations",
    owner_role: "project_coordinator",
    text: {
      he: { title: "שחרור משימה חסומה", purpose: "לא להשאיר משימה חסומה: לזהות את החסם ולפעול.", trigger: "משימה חסומה תקועה חסם נכשלה דורשת חיבור שחרור משימה אין מענה", steps: ["לקרוא את סיבת החסימה ביומן הפעילות", "חסר חיבור: להודיע לבעלים מה לחבר", "תלות שנכשלה: להפעיל מחדש את התלות", "חסומה יותר משלושה ימים: להציע ביטול עם סיבה"], success_metric: "אין משימה חסומה יותר משלושה ימים", escalation: "חסם שחוזר שלוש פעמים: למנהל ולבעלים", approvals: ["ביטול משימה של הבעלים"] },
      en: { title: "Unblocking a stuck task", purpose: "Never leave a task blocked: find the blocker and act.", trigger: "blocked task stuck blocker failed requires connection unblock task no response", steps: ["Read the reason for the block in the activity log", "Missing connection: tell the owner what to connect", "Failed dependency: restart the dependency", "Blocked for more than three days: propose cancelling with a reason"], success_metric: "No task blocked for more than three days", escalation: "A blocker that comes back three times: the manager and the owner", approvals: ["Cancelling a task the owner created"] },
      ar: { title: "فك مهمة عالقة", purpose: "عدم ترك مهمة عالقة: تحديد العائق والتصرف.", trigger: "مهمة عالقة متوقفة عائق فشلت تتطلب اتصالا فك مهمة لا رد", steps: ["قراءة سبب العائق في سجل النشاط", "اتصال مفقود: إبلاغ المالك بما يجب ربطه", "اعتماد فاشل: إعادة تشغيل الاعتماد", "عالقة أكثر من ثلاثة أيام: اقتراح الإلغاء مع السبب"], success_metric: "لا توجد مهمة عالقة أكثر من ثلاثة أيام", escalation: "عائق يتكرر ثلاث مرات: المدير والمالك", approvals: ["إلغاء مهمة أنشأها المالك"] },
    },
  },
  /* ---------------------------------------------------------------- finance */
  {
    key: "fin_overdue",
    dept: "finance",
    owner_role: "collections",
    text: {
      he: { title: "גבייה של חוב פתוח", purpose: "לגבות חוב באדיבות ובצורה מדורגת.", trigger: "גבייה חוב פתוח חשבונית באיחור תשלום באיחור תזכורת תשלום יתרה חוב", steps: ["לבדוק שהחוב אכן פתוח ושאין הסדר קיים", "תזכורת ראשונה אדיבה עם פרטי החשבונית", "אחרי שבעה ימים: תזכורת שנייה", "אחרי שתי תזכורות: להעביר לבעלים להחלטה"], success_metric: "תזכורת ראשונה תוך שלושה ימים מהאיחור", escalation: "חוב גדול או לקוח חשוב: לבעלים לפני כל פנייה", approvals: ["שליחת תזכורת תשלום", "הסדר תשלומים"] },
      en: { title: "Collecting an overdue debt", purpose: "Collect a debt politely and in steps.", trigger: "collection overdue debt overdue invoice late payment payment reminder balance debt", steps: ["Check the debt is really open and there is no arrangement", "A polite first reminder with the invoice details", "After seven days: a second reminder", "After two reminders: hand to the owner to decide"], success_metric: "First reminder within three days of the due date", escalation: "Large debt or an important customer: the owner before any contact", approvals: ["Sending a payment reminder", "A payment arrangement"] },
      ar: { title: "تحصيل دين مفتوح", purpose: "تحصيل الدين بلباقة وعلى مراحل.", trigger: "تحصيل دين مفتوح فاتورة متأخرة دفعة متأخرة تذكير بالدفع رصيد دين", steps: ["التأكد أن الدين مفتوح فعلا ولا توجد تسوية", "تذكير أول لبق مع تفاصيل الفاتورة", "بعد سبعة أيام: تذكير ثان", "بعد تذكيرين: التحويل للمالك للقرار"], success_metric: "تذكير أول خلال ثلاثة أيام من التأخر", escalation: "دين كبير أو عميل مهم: المالك قبل أي تواصل", approvals: ["إرسال تذكير بالدفع", "تسوية دفعات"] },
    },
  },
  {
    key: "fin_invoice_check",
    dept: "finance",
    owner_role: "collections",
    text: {
      he: { title: "בדיקת חשבוניות וסטטוס תשלומים", purpose: "לוודא שהמספרים הכספיים נכונים ומעודכנים.", trigger: "בדיקת חשבוניות סטטוס תשלומים התאמה הכנסות דוח כספי חשבונית", steps: ["לשלוף חשבוניות באיחור ואת היתרות מהמערכת", "להשוות לנתוני ההכנסות", "לסמן פערים ולא לתקן נתונים בלי אישור", "לדווח לבעלים בשורה אחת"], success_metric: "דוח כספי שבועי ללא פערים לא מוסברים", escalation: "פער שלא מוסבר: לבעלים", approvals: ["שינוי נתון כספי"] },
      en: { title: "Invoice and payment status check", purpose: "Make sure the financial numbers are right and current.", trigger: "invoice check payment status reconciliation revenue financial report invoice", steps: ["Pull overdue invoices and balances from the system", "Compare with the revenue figures", "Flag gaps and do not change data without approval", "Report to the owner in one line"], success_metric: "A weekly financial report with no unexplained gaps", escalation: "An unexplained gap: the owner", approvals: ["Changing a financial figure"] },
      ar: { title: "فحص الفواتير وحالة الدفعات", purpose: "التأكد من أن الأرقام المالية صحيحة ومحدثة.", trigger: "فحص الفواتير حالة الدفعات مطابقة الإيرادات تقرير مالي فاتورة", steps: ["سحب الفواتير المتأخرة والأرصدة من النظام", "المقارنة بأرقام الإيرادات", "تأشير الفجوات وعدم تعديل البيانات دون موافقة", "الإبلاغ للمالك في سطر واحد"], success_metric: "تقرير مالي أسبوعي بلا فجوات غير مفسرة", escalation: "فجوة غير مفسرة: المالك", approvals: ["تعديل رقم مالي"] },
    },
  },
  {
    key: "fin_refund",
    dept: "finance",
    owner_role: "collections",
    text: {
      he: { title: "בקשת החזר כספי", purpose: "לטפל בבקשת החזר לפי המדיניות, ותמיד באישור הבעלים.", trigger: "החזר כספי בקשת החזר זיכוי ביטול עסקה החזר", steps: ["לאתר את העסקה ולבדוק את מדיניות ההחזרים המאושרת", "לבדוק אם הבקשה בתוך תנאי המדיניות", "להכין המלצה עם סכום ונימוק", "להעביר לבעלים. אף החזר לא יוצא בלי אישור"], success_metric: "תשובה ללקוח תוך שני ימי עבודה", escalation: "בקשה מחוץ למדיניות: לבעלים עם המלצה", approvals: ["כל החזר או זיכוי"] },
      en: { title: "Refund request", purpose: "Handle a refund request by the policy, always with the owner's approval.", trigger: "refund request credit cancel transaction money back refund", steps: ["Find the transaction and check the confirmed refund policy", "Check whether the request is within the policy", "Prepare a recommendation with the amount and the reason", "Hand to the owner. No refund goes out without approval"], success_metric: "An answer to the customer within two working days", escalation: "A request outside the policy: the owner with a recommendation", approvals: ["Any refund or credit"] },
      ar: { title: "طلب استرداد مالي", purpose: "معالجة طلب الاسترداد وفق السياسة وبموافقة المالك دائما.", trigger: "استرداد مالي طلب استرداد رصيد إلغاء صفقة إعادة المبلغ", steps: ["تحديد الصفقة وفحص سياسة الاسترداد المعتمدة", "فحص هل الطلب ضمن شروط السياسة", "إعداد توصية بالمبلغ والسبب", "التحويل للمالك. لا استرداد بدون موافقة"], success_metric: "رد للعميل خلال يومي عمل", escalation: "طلب خارج السياسة: المالك مع توصية", approvals: ["أي استرداد أو رصيد"] },
    },
  },
  /* ---------------------------------------------------------------- management */
  {
    key: "mgmt_weekly_review",
    dept: "management",
    owner_role: "manager",
    text: {
      he: { title: "סקירה שבועית של הצוות", purpose: "לסכם את השבוע, לזהות חסמים ולקבוע סדרי עדיפויות.", trigger: "סקירה שבועית ישיבה שבועית סיכום שבוע ישיבת צוות סדר עדיפויות עדיפויות", steps: ["לקרוא את הדוח השבועי ואת הפיצול לפי מחלקה", "לזהות חסם אחד גדול ולהקצות לו בעלים", "לבדוק חריגות SLA וחריגות תקציב", "לנסח שלוש עדיפויות לשבוע הבא"], success_metric: "סקירה שבועית מתועדת בכל שבוע", escalation: "יעד בסיכון: לבעלים באותו יום", approvals: [] },
      en: { title: "Weekly team review", purpose: "Sum up the week, find blockers and set priorities.", trigger: "weekly review weekly meeting week summary team meeting priorities priority", steps: ["Read the weekly report and its split by department", "Find ONE big blocker and give it an owner", "Check SLA breaches and budget overruns", "Write three priorities for next week"], success_metric: "A documented weekly review every week", escalation: "A goal at risk: the owner the same day", approvals: [] },
      ar: { title: "المراجعة الأسبوعية للفريق", purpose: "تلخيص الأسبوع وتحديد العوائق وترتيب الأولويات.", trigger: "مراجعة أسبوعية اجتماع أسبوعي ملخص الأسبوع اجتماع الفريق أولويات", steps: ["قراءة التقرير الأسبوعي وتقسيمه حسب القسم", "تحديد عائق كبير واحد وإسناده لمسؤول", "فحص خروقات اتفاقيات الخدمة وتجاوزات الميزانية", "كتابة ثلاث أولويات للأسبوع القادم"], success_metric: "مراجعة أسبوعية موثقة كل أسبوع", escalation: "هدف معرض للخطر: المالك في نفس اليوم", approvals: [] },
    },
  },
  {
    key: "mgmt_goal_setting",
    dept: "management",
    owner_role: "manager",
    text: {
      he: { title: "קביעת יעד עסקי", purpose: "להציע יעד מדיד שהבעלים מפעיל.", trigger: "יעד עסקי קביעת יעד יעד חדש מטרה עסקית יעד מכירות יעד רבעוני", steps: ["לבחור מדד מדיד אחד מהרשימה", "לבדוק קו בסיס ממספרים אמיתיים", "להציע יעד ותאריך ריאליים, לא להמציא יעד שלא התבקש", "להגיש כהצעה. הבעלים מפעיל"], success_metric: "יעד עם מדד, בסיס, יעד ותאריך", escalation: "אין מספיק נתונים לקו בסיס: לומר זאת ולשאול", approvals: ["הפעלת יעד"] },
      en: { title: "Setting a business goal", purpose: "Propose a measurable goal that the owner activates.", trigger: "business goal set a goal new goal business objective sales goal quarterly goal", steps: ["Pick ONE measurable metric from the list", "Check a baseline from real numbers", "Propose a realistic target and date, never invent a target nobody asked for", "Submit as a proposal. The owner activates it"], success_metric: "A goal with a metric, baseline, target and date", escalation: "Not enough data for a baseline: say so and ask", approvals: ["Activating a goal"] },
      ar: { title: "تحديد هدف تجاري", purpose: "اقتراح هدف قابل للقياس يفعّله المالك.", trigger: "هدف تجاري تحديد هدف هدف جديد هدف المبيعات هدف ربع سنوي", steps: ["اختيار مقياس واحد قابل للقياس من القائمة", "فحص خط الأساس من أرقام حقيقية", "اقتراح هدف وموعد واقعيين وعدم اختراع هدف لم يُطلب", "التقديم كاقتراح. المالك يفعّله"], success_metric: "هدف بمقياس وأساس وهدف وموعد", escalation: "بيانات غير كافية لخط الأساس: قل ذلك واسأل", approvals: ["تفعيل هدف"] },
    },
  },
  {
    key: "mgmt_incident",
    dept: "management",
    owner_role: "manager",
    text: {
      he: { title: "אירוע חריג", purpose: "להגיב לאירוע חריג: עצירה, דיווח ותיקון.", trigger: "אירוע חריג תקלה חמורה משבר פגיעה במוניטין דליפה מידע שגוי נשלח עצירת חירום", steps: ["לעצור פעולות שקשורות לאירוע", "לדווח לבעלים מיד: מה קרה, מי מושפע", "לאסוף עובדות מיומן הפעילות", "להציע תיקון ולתעד לקח"], success_metric: "הבעלים מקבל דיווח תוך שעה מזיהוי האירוע", escalation: "תמיד לבעלים", approvals: ["כל הודעה ללקוחות על האירוע"] },
      en: { title: "Exceptional incident", purpose: "Respond to an incident: stop, report and fix.", trigger: "incident severe failure crisis reputation damage leak wrong information sent emergency stop", steps: ["Stop the actions related to the incident", "Report to the owner at once: what happened, who is affected", "Collect facts from the activity log", "Propose a fix and record the lesson"], success_metric: "The owner gets a report within one hour of detection", escalation: "Always the owner", approvals: ["Any message to customers about the incident"] },
      ar: { title: "حادث استثنائي", purpose: "الاستجابة للحادث: إيقاف وإبلاغ وإصلاح.", trigger: "حادث عطل خطير أزمة ضرر بالسمعة تسريب معلومة خاطئة أُرسلت إيقاف طارئ", steps: ["إيقاف الإجراءات المتعلقة بالحادث", "إبلاغ المالك فورا: ماذا حدث ومن تأثر", "جمع الحقائق من سجل النشاط", "اقتراح إصلاح وتسجيل الدرس"], success_metric: "يتلقى المالك تقريرا خلال ساعة من اكتشاف الحادث", escalation: "المالك دائما", approvals: ["أي رسالة للعملاء عن الحادث"] },
    },
  },
];

export const DEFAULT_SOP_MAP: Record<string, DefaultSop> = Object.fromEntries(DEFAULT_SOPS.map((s) => [s.key, s]));
