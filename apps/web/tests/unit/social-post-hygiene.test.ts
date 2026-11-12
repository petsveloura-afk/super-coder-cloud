import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPostBody, hasReportShape, isFreshPost, isNotAPost, markPostBody, nextFreeSlot, outgoingText, plainForSocial, postAuthor, sortPosts, suspectManualPost } from "@/lib/social/post-hygiene-core";
import { extractPosts } from "@/lib/team/execution-plus-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("post hygiene — only the post itself reaches the board", () => {
  it("a notes / assumptions block is not a post (the screenshot case)", () => {
    const notes = "**הנחות:**\n- הפוסט שנבחר לתזמון הינו טקסט התוכן המלא של דור (\"איך לחסוך 5 שעות בשבוע...\").";
    expect(cleanPostBody(notes).ok).toBe(false);
    expect(cleanPostBody("Assumptions:\n- the post is for the business page").ok).toBe(false);
    expect(cleanPostBody("ملاحظات:\n- المنشور مخصص لصفحة العمل").ok).toBe(false);
  });

  it("a report about the post (ids, scheduling confirmation) is refused", () => {
    const report = "**אישור תזמון פוסט במערכת**\n\n**מזהה פוסט (ID):** `bf18ba7a-1532-4524-93cf-433e7e743806`\n**נושא הפוסט:** איך לחסוך 5 שעות בשבוע";
    const r = cleanPostBody(report);
    expect(r).toEqual({ ok: false, reason: "not_a_post" });
    expect(cleanPostBody("Post draft saved (id 1234) — waiting for the owner on the posts board").ok).toBe(false);
  });

  it("a real post keeps its words, loses markdown and the trailing notes", () => {
    const post = "**רוצים לבדוק איך אפשר לייעל ולחבר את האוטומציות והמערכות בעסק שלכם?**\nשלחו לנו הודעה פרטית עכשיו ונשמח לייעץ ולבחון יחד את הצעד הבא שלכם! 🚀\n\n**הנחות:**\n- לא צוינו מחירים";
    const r = cleanPostBody(post);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("רוצים לבדוק איך אפשר לייעל");
      expect(r.text).toContain("🚀");
      expect(r.text).not.toContain("**");
      expect(r.text).not.toContain("הנחות");
      expect(r.text).not.toContain("לא צוינו מחירים");
    }
  });

  it("a label line in front of the post goes, the post stays", () => {
    const r = cleanPostBody("**הפוסט:**\nבוקר טוב! השבוע אנחנו פותחים הרשמה לסדנה החדשה — מקומות מוגבלים 🙌");
    expect(r.ok && r.text.startsWith("בוקר טוב")).toBe(true);
  });

  it("plain text helper — headings, bold, code marks", () => {
    expect(plainForSocial("## כותרת\n**חזק** ו`קוד`")).toBe("כותרת\nחזק וקוד");
    expect(plainForSocial("שורה\n\n\n\nשורה")).toBe("שורה\n\nשורה");
  });

  it("a person's post goes out exactly as written; an agent's goes out clean", () => {
    expect(outgoingText("**שלי** כמו שכתבתי", "manual")).toBe("**שלי** כמו שכתבתי");
    expect(outgoingText("**מבצע** לסוף השבוע — 20% הנחה על כל הקולקציה", "agent")).toBe("מבצע לסוף השבוע — 20% הנחה על כל הקולקציה");
  });

  it("the team's extracted posts drop the notes part (extractPosts + cleanPostBody, as the engine does)", () => {
    const deliverable = "בוקר טוב לכל הלקוחות! השבוע אנחנו משיקים שירות חדש שיחסוך לכם שעות של עבודה ידנית 🙌\n\n---\n\n**הנחות:**\n- הפוסט מיועד לפרסום בדף הפייסבוק של העסק כפוסט ערך לבעלי עסקים.\n- לא צוינו מחירים או התחייבויות.";
    const raw = extractPosts(deliverable);
    expect(raw.length).toBe(2);
    const posts = [...new Set(raw.map((x) => cleanPostBody(x)).flatMap((c) => (c.ok ? [c.text] : [])))];
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("בוקר טוב");
  });
});

describe("the board — who wrote it, order, new", () => {
  it("the employee's name for agent posts; nothing for a person's post", () => {
    expect(postAuthor({ source: "agent", agent_name: "נועה" })).toEqual({ key: "social.author.employee", params: { name: "נועה" } });
    expect(postAuthor({ source: "agent", origin: "studio" })).toEqual({ key: "social.author.team" });
    expect(postAuthor({ source: "agent", origin: "week" })).toEqual({ key: "social.author.autopilot" });
    expect(postAuthor({ source: "agent" })).toEqual({ key: "social.byAgent" });
    expect(postAuthor({ source: "manual", agent_name: "x" })).toBeNull();
  });

  it("a stable order: newest created first, ties broken by planned time and id", () => {
    const same = "2026-11-08T08:00:00.000Z";
    const posts = [
      { id: "a", scheduled_at: same, created_at: "2026-11-07T10:00:00Z" },
      { id: "b", scheduled_at: same, created_at: "2026-11-07T12:00:00Z" },
      { id: "c", scheduled_at: "2026-11-09T08:00:00Z", created_at: "2026-11-06T09:00:00Z" },
    ];
    expect(sortPosts(posts, "newest").map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(sortPosts(posts, "schedule").map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(sortPosts([...posts].reverse(), "newest").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });

  it("new = created within the last day", () => {
    const now = Date.parse("2026-11-07T20:00:00Z");
    expect(isFreshPost({ created_at: "2026-11-07T10:00:00Z" }, now)).toBe(true);
    expect(isFreshPost({ created_at: "2026-11-05T10:00:00Z" }, now)).toBe(false);
    expect(isFreshPost({ created_at: null }, now)).toBe(false);
  });

  it("agent drafts without a time get the next FREE morning (no pile-up on one minute)", () => {
    const now = new Date("2026-11-07T20:00:00Z");
    const first = nextFreeSlot([], now);
    expect(first.toISOString()).toBe("2026-11-08T08:00:00.000Z");
    const second = nextFreeSlot([first.toISOString()], now);
    expect(second.toISOString()).toBe("2026-11-09T08:00:00.000Z");
  });
});

describe("wiring", () => {
  it("the team's save-draft tool cleans, refuses reports and records the employee", () => {
    const tools = read("lib/team/tools.ts");
    expect(tools).toContain("cleanPostBody(s(args.text))");
    expect(tools).toContain("agent_name: agentName }");
    expect(tools).toContain("nextFreeSlot(");
    expect(read("lib/team/runner.ts")).toContain("agentName: member.name");
    expect(read("lib/team/engine-core.ts")).toContain("extractPosts(draft).map((x) => cleanPostBody(x))");
  });

  it("publishing sends an agent post clean (Facebook / Instagram / Telegram)", () => {
    const pub = read("lib/social/publish.ts");
    expect(pub.match(/outgoingText\(p\.body, p\.source\)/g)?.length).toBe(3);
  });

  it("the board shows the author, the created time, a stable order and a sort choice", () => {
    const ui = read("components/social/social-client.tsx");
    expect(ui).toContain("postAuthor(p)");
    expect(ui).toContain('data-testid="post-created"');
    expect(ui).toContain("sortPosts(filterPosts(p.posts, pf), postSort)");
    const page = read("app/[locale]/(dashboard)/social/page.tsx");
    expect(page).toContain('.order("created_at", { ascending: false })');
    expect(page).toContain('select("id, agent_name")');
  });

  it("the migration is additive and only sets aside agent drafts (nothing deleted)", () => {
    const sql = read("../../supabase/migrations/20261107000001_social_post_hygiene.sql");
    expect(sql).toContain("add column if not exists agent_name");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).toContain("source = 'agent'");
  });

  it("i18n — the new labels exist in he / en / ar", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { social: { author: Record<string, string>; sort: Record<string, string> } };
      expect(d.social.author.employee).toContain("{name}");
      expect(Object.keys(d.social.sort)).toEqual(["label", "newest", "schedule", "fresh", "createdAt", "plannedFor"]);
    }
  });
});

describe("post hygiene — round 2 (publishing guard, edit pop-up, writing rules)", () => {
  it("publishing never sends an agent 'post' that is only notes / a report — it returns to the owner as a draft", () => {
    const src = read("lib/social/publish.ts");
    expect(src).toContain('p.source === "agent" && !cleanPostBody(p.body).ok');
    expect(src).toContain('hygiene: "not_a_post"');
  });

  it("editing an existing post opens a pop-up dialog (not the top of the board)", () => {
    const src = read("components/social/social-client.tsx");
    expect(src).toContain('open={editing !== null && editing !== "new"}');
    expect(src).toContain('data-testid="post-edit-dialog"');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { social: { editPost?: { title?: string } } };
      expect(d.social.editPost?.title).toBeTruthy();
    }
  });

  it("the team is told a post is customer-facing marketing text — notes go after all posts", () => {
    const src = read("lib/team/execution-plus-core.ts");
    expect(src).toContain("A post is the marketing text the CUSTOMER reads");
    expect(read("lib/team/tools-plus9-core.ts")).toContain("only the customer-facing marketing post");
  });

  it("the tidy-up migration covers scheduled agent posts too (canceled, never deleted)", () => {
    const sql = readFileSync(join(root, "..", "..", "supabase/migrations/20261107000001_social_post_hygiene.sql"), "utf8");
    expect(sql).toContain("status in ('draft', 'scheduled')");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe("post hygiene — round 3 (report detector, marked extraction, board / approve / schedule guard)", () => {
  it("a title line above the post goes, the post stays; a title alone is not a post", () => {
    const r = cleanPostBody("**תוצאה סופית**\nבוקר טוב! השבוע אנחנו פותחים הרשמה לסדנה החדשה — מקומות מוגבלים 🙌");
    expect(r.ok && r.text.startsWith("בוקר טוב")).toBe(true);
    expect(cleanPostBody("**תוצאה סופית:**").ok).toBe(false);
    // a sentence that merely starts with the word is a post line, not a heading
    const s = cleanPostBody("סיכום השנה שלנו: הלקוחות שלנו חסכו אלפי שעות עבודה ידנית 🙌");
    expect(s.ok).toBe(true);
  });

  it("a status report (two or more field lines) is refused, one field line inside a real post is not", () => {
    const report = "סטטוס: תוזמן\nפלטפורמות: facebook, instagram\nמועד פרסום: מחר 10:00";
    expect(hasReportShape(report)).toBe(true);
    expect(cleanPostBody(report)).toEqual({ ok: false, reason: "not_a_post" });
    expect(hasReportShape("Status: scheduled\nPlatforms: facebook")).toBe(true);
    expect(cleanPostBody("מבצע סוף שבוע לכל הלקוחות שלנו!\nסטטוס: מלאי מוגבל, מזהים את זה בחנות 🙌").ok).toBe(true);
  });

  it("marked extraction keeps the text and marks it; a real post is not marked", () => {
    const m = markPostBody("**הנחות:**\n- הפוסט מיועד לדף העסק");
    expect(m.notAPost).toBe(true);
    expect(m.reason).toBeTruthy();
    expect(m.text).toContain("הנחות");
    const ok = markPostBody("**מבצע** לסוף השבוע — 20% הנחה על כל הקולקציה");
    expect(ok).toEqual({ text: "מבצע לסוף השבוע — 20% הנחה על כל הקולקציה", notAPost: false });
  });

  it("isNotAPost: only an agent's notes / report; a person's text and a real agent post are never marked", () => {
    expect(isNotAPost({ body: "**הנחות:**\n- משהו", source: "agent" })).toBe(true);
    expect(isNotAPost({ body: "**הנחות:**\n- משהו", source: "manual" })).toBe(false);
    expect(isNotAPost({ body: "מבצע לסוף השבוע — 20% הנחה על כל הקולקציה", source: "agent" })).toBe(false);
  });

  it("such a 'post' is never approved, scheduled or published — the board marks it", () => {
    const actions = read("app/[locale]/(dashboard)/social/actions.ts");
    expect(actions).toContain('import { isNotAPost } from "@/lib/social/post-hygiene-core"');
    // approve / publish-now (cancel stays possible)
    expect(actions).toContain('if (input.action !== "cancel") {');
    expect(actions.match(/social\.notAPost\.blocked/g)?.length).toBe(2);
    // approve-all skips them
    expect(actions).toContain("isNotAPost({ body: String(d.body ?? \"\"), source: d.source })");
    expect(actions).toContain('.not("id", "in", skipList)');
    // the team's schedule tool and the publishing guard
    expect(read("lib/team/tools.ts")).toContain("not_a_post: this draft is notes or a report");
    expect(read("lib/social/publish.ts")).toContain('p.source === "agent" && !cleanPostBody(p.body).ok');
    // the board: red mark, no approve / publish-now buttons
    const ui = read("components/social/social-client.tsx");
    expect(ui).toContain('data-testid="post-not-a-post"');
    expect(ui).toContain('p.status === "draft" && !notAPost');
    expect(ui).toContain("editable && !isNotAPost(post)");
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { social: { notAPost: Record<string, string> } };
      expect(Object.keys(d.social.notAPost)).toEqual(["badge", "hint", "suspect", "blocked"]);
    }
  });
});

describe("post hygiene — round 4 (all the wordings, AI chat lead-ins / tails, warning on a person's notes)", () => {
  const POST = "מבצע סוף שבוע לכל הלקוחות שלנו — 20% הנחה על כל הקולקציה, רק עד יום שישי 🙌";
  it("notes / instructions sections in he / en / ar are cut, the post stays", () => {
    const heads = ["הנחיות לפרסום:", "**הערות מערכת:**", "הצעה לתמונה:", "המלצות לפרסום:", "שעת פרסום מומלצת:", "נימוק:", "Instructions:", "Image suggestion:", "Recommended posting time:", "Editor's note:", "Next steps:", "تعليمات:", "اقتراح صورة:", "أفضل وقت للنشر:", "ملاحظات النشر:"];
    for (const h of heads) {
      const r = cleanPostBody(`${POST}\n\n${h}\n- משהו פנימי`);
      expect(r.ok, h).toBe(true);
      if (r.ok) expect(r.text, h).toBe(POST);
    }
  });
  it("a real post line that only looks similar is kept (a recipe 'הוראות:' / 'הוראות הגעה:')", () => {
    const r = cleanPostBody("מתכון חדש אצלנו השבוע, בואו להכין יחד!\nהוראות:\n1. מערבבים\n2. אופים 20 דקות");
    expect(r.ok && r.text.includes("אופים 20 דקות")).toBe(true);
    const r2 = cleanPostBody("מחכים לכם בסניף החדש ברחוב הרצל 5!\nהוראות הגעה: חניה חינם ליד הכניסה");
    expect(r2.ok && r2.text.includes("חניה חינם")).toBe(true);
  });
  it("an AI lead-in and closing offer around the post are cut", () => {
    const a = cleanPostBody(`הנה הפוסט:\n${POST}\n\nרוצה שאשנה משהו בנוסח?`);
    expect(a).toEqual({ ok: true, text: POST });
    const b = cleanPostBody(`Sure! Here's the post:\n\n${POST}\n\nLet me know if you'd like changes.`);
    expect(b).toEqual({ ok: true, text: POST });
    const c = cleanPostBody("```\n" + POST + "\n```");
    expect(c).toEqual({ ok: true, text: POST });
    // a customer-facing CTA is part of the post
    const d = cleanPostBody("רוצים לשמוע עוד? שלחו לנו הודעה פרטית ונשמח לעזור לכם בכל שאלה 🚀");
    expect(d.ok).toBe(true);
  });
  it("more reports about a post are refused", () => {
    expect(cleanPostBody("הפוסט תוזמן בהצלחה ליום ראשון ונוסף ללוח, ממתין לאישורך").ok).toBe(false);
    expect(cleanPostBody("Post was created and added to the calendar, awaiting your approval").ok).toBe(false);
    expect(cleanPostBody("تمت الجدولة بنجاح وفي انتظار الموافقة على المنشور").ok).toBe(false);
  });
  it("a person's own text that has notes inside gets a warning only — never blocked, never changed", () => {
    expect(suspectManualPost({ body: `${POST}\n\nהנחיות לפרסום:\n- משהו`, source: "manual" })).toBe(true);
    expect(suspectManualPost({ body: POST, source: "manual" })).toBe(false);
    expect(suspectManualPost({ body: `${POST}\n\nהנחיות לפרסום:\n- משהו`, source: "agent" })).toBe(false);
    expect(outgoingText(`${POST}\n\nהנחיות לפרסום:\n- משהו`, "manual")).toContain("הנחיות לפרסום");
    expect(read("components/social/social-client.tsx")).toContain('data-testid="post-suspect"');
  });
});

describe("post hygiene — round 3 (plans split into 'posts', structured versions) — the owner's screenshots", () => {
  const notPost = [
    "המלצות לקידום ממוקד (Boost)\n1. תקציב מומלץ לבוסט ראשוני: 100–150 ש\"ח לפוסט למשך 4 ימים.\n2. קהל יעד ממוקד: בעלי עסקים קטנים, עצמאיים, ומנהלי שיווק (גילאי 25–55) באזור ישראל.\n3. תחומי עניין לבחירה במודעה: בניה ועיצוב אתרים, אוטומציה",
    "לוח זמנים מומלץ לתזמון ופרסום\n* יום פרסום מומלץ: יום שני (09/11/2026)\n* חלונות זמן מומלצים לפרסום:\n* בוקר: 09:00 – 10:00 (שעות הגעה למשרד / מעבר על רשתות).\n* ערב: 18:30 – 20:00 (זמן פנאי וצריכת תוכן)",
    "ממצאים מרכזיים ונתונים\n1. הפוסט שנבחר להפצה (FACT):\n* טיוטה נבחרת: \"🚀 10% הנחה על דף נחיתה + אוטומציה ללא קוד! חסכו זמן: תהליכים מתוזמנים אוטומטית...\"\n* סיבה לבחירה: שילוב עקרון הערך של",
    "תוצאה סופית: תוכנית הפצה ותזמון לפוסט במדיה החברתית",
  ];
  it("plans, recommendations, findings and report titles are not posts", () => {
    for (const t of notPost) expect(cleanPostBody(t).ok, t.slice(0, 30)).toBe(false);
  });
  it("a structured version keeps only its copy (opening + body), without headings and labels", () => {
    const v = "2. גרסת אינסטגרם (Instagram Post)\n* פתיחה: ✨ רוצים יותר לידים בפחות זמן עבודה?\n* גוף הפוסט:\nדף נחיתה ממיר + חיבור אוטומטי למערכות העסק שלכם.\n• עיצוב חדשני ומותאם למובייל\n* סיבה לבחירה: ערך גבוה";
    const r = cleanPostBody(v);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.startsWith("✨ רוצים יותר לידים")).toBe(true);
      expect(r.text).toContain("דף נחיתה ממיר");
      expect(r.text).not.toMatch(/גרסת|Instagram Post|פתיחה:|גוף הפוסט|סיבה לבחירה/);
    }
  });
  it("'נוסח הפוסט המלא (מוכן לפרסום):' — the label goes, the post stays", () => {
    const r = cleanPostBody("נוסח הפוסט המלא (מוכן לפרסום):\n\nעסוקים בלרדוף אחרי לידים ולבצע פעולות ידניות חוזרות ונשנות? ⏱️\n\nבעלי עסקים רבים מאבדים לקוחות משלמים בגלל...");
    expect(r.ok && r.text.startsWith("עסוקים בלרדוף")).toBe(true);
  });
  it("the real marketing posts from the board stay posts", () => {
    for (const t of [
      "🚀 קבלו דף נחיתה ב-10% הנחה + MVP מוכן תוך 2 שבועות!\nעיצוב מותאם למובייל שממיר כל ביקור ללקוח.\nפיתוח מהיר שמחסך לכם זמן וכסף.\nהודעה עכשיו לקבלת הצעת מחיר מותאמת.\n#דפנחיתה #SuperCoderIL MVP",
      "📈 מחפשים דרך להגדיל את המכירות?\n\nדף נחיתה מקצועי יעשה את העבודה בשבילכם.\n\nעיצוב חדשני, מהירות טעינה גבוהה והתאמה מלאה למובייל.",
      "למה עסקים נתקעים במקום במקום לגדול? 📉\nבעלי עסקים רבים מתמודדים עם אותן בעיות נפוצות: ❌ לידים שנופלים בין הכלסאות בגלל חוסר מעקב אוטומטי",
      "💥 10% הנחה על דף נחיתה + קוד ריוויו לפני מיזוג!\nחוסך זמן יקר ומונע באגים לפני שהקוד מגיע ל-production.",
    ]) expect(cleanPostBody(t).ok, t.slice(0, 30)).toBe(true);
  });
});
