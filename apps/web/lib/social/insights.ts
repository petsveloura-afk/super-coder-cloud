/**
 * Wave 36 — pure helpers for the social hub: numbers for the overview, the month calendar,
 * per-network limits, suggested times, post templates, filters and CSV export.
 * No server-only, no database: everything is computed from rows the page already has.
 */
export interface PostLite {
  id: string;
  platforms: string[];
  body: string;
  scheduled_at: string;
  status: string;
  source?: string;
  results?: Record<string, { ok?: boolean; error?: string }> | null;
}
export interface CommentLite {
  id: string;
  platform: string;
  author_name: string | null;
  body: string;
  sentiment: string | null;
  status: string;
  created_at: string;
}
export interface ReviewLite {
  id: string;
  author: string | null;
  rating: number | null;
  body: string;
  reply: string | null;
  status: string;
  reviewed_at: string | null;
}

/* ------------------------------------------------------------------ overview */
export interface AttentionItem {
  kind: "failedPost" | "draftWaiting" | "negativeComment" | "lowReview" | "pastDue";
  id: string;
  tab: "comments" | "posts" | "reviews";
}

export function computeStats(posts: PostLite[], comments: CommentLite[], reviews: ReviewLite[], now = new Date()) {
  const week = now.getTime() + 7 * 86_400_000;
  const by = (s: string) => posts.filter((p) => p.status === s).length;
  const upcoming = posts.filter((p) => p.status === "scheduled" && new Date(p.scheduled_at).getTime() >= now.getTime());
  const openComments = comments.filter((c) => c.status === "new" || c.status === "dm_sent");
  const answered = comments.filter((c) => ["replied", "auto_replied", "hidden"].includes(c.status)).length;
  const sentiment: Record<string, number> = {};
  for (const c of comments) sentiment[c.sentiment ?? "neutral"] = (sentiment[c.sentiment ?? "neutral"] ?? 0) + 1;
  const rated = reviews.filter((r) => typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5);
  const dist = [0, 0, 0, 0, 0];
  for (const r of rated) dist[Math.round(r.rating as number) - 1]!++;
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length : null;
  const unanswered = reviews.filter((r) => !r.reply);
  const attention: AttentionItem[] = [];
  for (const p of posts) if (p.status === "failed") attention.push({ kind: "failedPost", id: p.id, tab: "posts" });
  for (const p of posts) if (p.status === "scheduled" && new Date(p.scheduled_at).getTime() < now.getTime() - 15 * 60_000) attention.push({ kind: "pastDue", id: p.id, tab: "posts" });
  for (const c of openComments) if (c.sentiment === "negative") attention.push({ kind: "negativeComment", id: c.id, tab: "comments" });
  for (const r of unanswered) if ((r.rating ?? 5) <= 2 && r.rating !== null) attention.push({ kind: "lowReview", id: r.id, tab: "reviews" });
  if (by("draft") > 0) attention.push({ kind: "draftWaiting", id: "drafts", tab: "posts" });
  return {
    posts: { draft: by("draft"), scheduled: by("scheduled"), published: by("published") + by("partial"), failed: by("failed"), nextWeek: upcoming.filter((p) => new Date(p.scheduled_at).getTime() <= week).length },
    comments: { total: comments.length, open: openComments.length, answered, responseRate: comments.length ? Math.round((answered / comments.length) * 100) : null, sentiment },
    reviews: { total: reviews.length, avg: avg === null ? null : Math.round(avg * 10) / 10, dist, unanswered: unanswered.length },
    attention,
  };
}

/* ------------------------------------------------------------------ calendar */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** weeks of a month (Sunday first, as in Israel); days outside the month are flagged */
export function monthGrid(year: number, month: number): { key: string; day: number; inMonth: boolean }[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks: { key: string; day: number; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      row.push({ key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month });
    }
    if (w >= 4 && row.every((x) => !x.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}

export function postsByDay<T extends { scheduled_at: string }>(posts: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const p of posts) {
    const k = dayKey(new Date(p.scheduled_at));
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  for (const list of map.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return map;
}

/** value for an <input type="datetime-local"> at a given day and hour */
export function localInput(day: string, hh = 10, mm = 0) {
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ limits & times */
export const NETWORK_LIMITS = { facebook: { chars: 5000, soft: 480 }, instagram: { chars: 2200, soft: 125, hashtags: 30 } } as const;

export function charInfo(text: string, platform: "facebook" | "instagram") {
  const len = [...text].length;
  const lim = NETWORK_LIMITS[platform];
  const hashtags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const tooLong = len > lim.chars;
  const tooManyTags = platform === "instagram" && hashtags > NETWORK_LIMITS.instagram.hashtags;
  return { len, limit: lim.chars, hashtags, tooLong, tooManyTags, ok: !tooLong && !tooManyTags, remaining: lim.chars - len };
}

/** three upcoming "good times" (morning, lunch, evening) — suggestions, not statistics */
export function suggestedSlots(now = new Date()): Date[] {
  const slots: Date[] = [];
  const times: [number, number][] = [[9, 0], [12, 30], [19, 30]];
  for (let add = 0; slots.length < 3 && add < 3; add++) {
    for (const [h, m] of times) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, h, m);
      if (d.getTime() > now.getTime() + 20 * 60_000 && slots.length < 3) slots.push(d);
    }
  }
  return slots;
}

/* ------------------------------------------------------------------ templates */
export type TemplateKey = "offer" | "tip" | "testimonial" | "question" | "announce";
export const TEMPLATE_KEYS: TemplateKey[] = ["offer", "tip", "testimonial", "question", "announce"];
export const POST_TEMPLATES: Record<"he" | "en" | "ar", Record<TemplateKey, string>> = {
  he: {
    offer: "🎁 מבצע מיוחד השבוע!\n[מה מקבלים] — [מחיר/הטבה]\nהצעה בתוקף עד [תאריך]. שלחו לנו הודעה ונסגור הכול ✅\n#מבצע",
    tip: "💡 טיפ מהמומחים:\n[הטיפ בשורה אחת]\nרוצים עוד טיפים כאלה? עקבו אחרינו 👆",
    testimonial: "⭐ מה הלקוחות שלנו אומרים:\n״[ציטוט קצר מלקוח]״ — [שם הלקוח]\nתודה על האמון! 💙",
    question: "🤔 שאלה לכם:\n[שאלה פשוטה שקל לענות עליה]\nכתבו לנו בתגובות 👇",
    announce: "📣 חדש אצלנו!\n[מה השתנה / מה חדש]\nפרטים ותיאום בהודעה פרטית.",
  },
  en: {
    offer: "🎁 This week's special offer!\n[What you get] — [price / benefit]\nValid until [date]. Message us and we'll sort it out ✅\n#offer",
    tip: "💡 Expert tip:\n[The tip in one line]\nWant more like this? Follow us 👆",
    testimonial: "⭐ What our customers say:\n\"[short customer quote]\" — [customer name]\nThank you for the trust! 💙",
    question: "🤔 A question for you:\n[an easy question to answer]\nTell us in the comments 👇",
    announce: "📣 New at our place!\n[what changed / what is new]\nDetails and booking by private message.",
  },
  ar: {
    offer: "🎁 عرض خاص هذا الأسبوع!\n[ما الذي تحصل عليه] — [السعر / الميزة]\nالعرض ساري حتى [التاريخ]. راسلونا ونرتب كل شيء ✅\n#عرض",
    tip: "💡 نصيحة من الخبراء:\n[النصيحة في سطر واحد]\nتريدون المزيد؟ تابعونا 👆",
    testimonial: "⭐ ماذا يقول عملاؤنا:\n«[اقتباس قصير من عميل]» — [اسم العميل]\nشكرًا على ثقتكم! 💙",
    question: "🤔 سؤال لكم:\n[سؤال بسيط يسهل الإجابة عنه]\nاكتبوا لنا في التعليقات 👇",
    announce: "📣 جديد لدينا!\n[ما الذي تغيّر / ما الجديد]\nالتفاصيل والحجز عبر رسالة خاصة.",
  },
};

/* ------------------------------------------------------------------ filters */
export type PostFilter = { status: "all" | "draft" | "scheduled" | "published" | "failed"; platform: "all" | "facebook" | "instagram"; q: string };
export function filterPosts<T extends PostLite>(posts: T[], f: PostFilter): T[] {
  const q = f.q.trim().toLowerCase();
  return posts.filter((p) => {
    if (f.status !== "all" && !(f.status === "published" ? p.status === "published" || p.status === "partial" : p.status === f.status)) return false;
    if (f.platform !== "all" && !p.platforms.includes(f.platform)) return false;
    return !q || p.body.toLowerCase().includes(q);
  });
}
export type CommentFilter = { status: "all" | "open" | "done"; sentiment: "all" | "negative" | "lead" | "question" | "positive" | "spam"; platform: "all" | "facebook" | "instagram"; q: string };
export function filterComments<T extends CommentLite>(items: T[], f: CommentFilter): T[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((c) => {
    const open = c.status === "new" || c.status === "dm_sent";
    if (f.status === "open" && !open) return false;
    if (f.status === "done" && open) return false;
    if (f.sentiment !== "all" && (c.sentiment ?? "neutral") !== f.sentiment) return false;
    if (f.platform !== "all" && c.platform !== f.platform) return false;
    return !q || c.body.toLowerCase().includes(q) || (c.author_name ?? "").toLowerCase().includes(q);
  });
}
export type ReviewFilter = { stars: "all" | "1" | "2" | "3" | "4" | "5"; unanswered: boolean; q: string };
export function filterReviews<T extends ReviewLite>(items: T[], f: ReviewFilter): T[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((r) => {
    if (f.stars !== "all" && Math.round(r.rating ?? 0) !== Number(f.stars)) return false;
    if (f.unanswered && r.reply) return false;
    return !q || r.body.toLowerCase().includes(q) || (r.author ?? "").toLowerCase().includes(q);
  });
}

/* ------------------------------------------------------------------ CSV (Excel-safe, formula-injection-safe) */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
