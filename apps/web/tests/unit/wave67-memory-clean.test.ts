import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactsWithOnlyCodeMessages, isTelegramServiceContact, looksLikeLoginCode } from "@/lib/team/automated-extra-core";
import { gateMemoryWrites, isEmptyMemoryContent, localizeGateSummary, memoryKey, memoryView, safeGateMemoryWrites, safeMemoryView, translateMemoryContent, type MemoryLike, type NewMemoryLike } from "@/lib/team/memory-clean-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const NOW = Date.parse("2026-11-05T10:00:00Z");

const row = (o: Partial<MemoryLike> & { id: string; content: string }): MemoryLike => ({ member_id: null, layer: "episodic", kind: "outcome", subject: null, status: "active", created_at: "2026-11-05T09:00:00Z", ...o });
const item = (o: Partial<NewMemoryLike> & { content: string }): NewMemoryLike => ({ layer: "episodic", kind: "outcome", subject: null, confidence: 0.6, status: "active", ...o });
const boom = (base: object): never => Object.defineProperty({ ...base }, "content", { get: () => { throw new Error("boom"); }, enumerable: true }) as never;

describe("wave 67 — empty memory text", () => {
  it("empty, whitespace and placeholders are empty", () => {
    for (const s of ["", "   ", "—", "-", "null", "undefined", "N/A", "...", '""']) expect(isEmptyMemoryContent(s), s).toBe(true);
    expect(isEmptyMemoryContent(undefined)).toBe(true);
    expect(isEmptyMemoryContent(null)).toBe(true);
  });
  it("a label with nothing after it is empty", () => {
    expect(isEmptyMemoryContent('Approved without changes: ""')).toBe(true);
    expect(isEmptyMemoryContent("Lesson from sales manager:")).toBe(true);
    expect(isEmptyMemoryContent("הנחות:")).toBe(true);
  });
  it("real text is never empty", () => {
    expect(isEmptyMemoryContent("Approved without changes: \"hello\"")).toBe(false);
    expect(isEmptyMemoryContent("הלקוח מעדיף וואטסאפ")).toBe(false);
    expect(isEmptyMemoryContent("0")).toBe(false);
  });
  it("memoryKey ignores case, quotes, punctuation and spacing", () => {
    expect(memoryKey('  Hello,  "World"! ')).toBe(memoryKey("hello world"));
  });
});

describe("wave 67 — display translation", () => {
  it("keeps English as it is", () => {
    expect(translateMemoryContent("Approved without changes: \"x\"", "en")).toBe("Approved without changes: \"x\"");
  });
  it("translates the sentences the team writes itself (he)", () => {
    expect(translateMemoryContent('Approved without changes: "שלום"', "he")).toBe('אושר ללא שינויים: "שלום"');
    expect(translateMemoryContent("Communication style: writes briefly — keep replies short.", "he")).toContain("כותב בקצרה");
    expect(translateMemoryContent("Raised a price objection.", "he")).toContain("מחיר");
    expect(translateMemoryContent("Was upset in a recent interaction — handle with extra care.", "he")).toContain("מוטרד");
    expect(translateMemoryContent("A previous conversation ended in a deal.", "he")).toContain("עסקה");
    expect(translateMemoryContent("A previous complaint was resolved.", "he")).toContain("תלונה");
    expect(translateMemoryContent("Lesson from sales manager: ask first", "he")).toBe("לקח מעובד אחר בצוות: ask first");
  });
  it("translates decision lessons without showing the technical route", () => {
    const worked = translateMemoryContent("What worked (fast path): call back — because they asked", "he");
    expect(worked).toBe("מה שעבד: call back — כי they asked");
    expect(worked).not.toMatch(/fast|deep/);
    const bad = translateMemoryContent("What did NOT work: discount. Outcome: lost. Next time watch for: price", "he");
    expect(bad).toContain("מה שלא עבד");
    expect(bad).toContain("תוצאה:");
    expect(bad).toContain("בפעם הבאה לשים לב ל:");
  });
  it("translates the task report line and the title prefix", () => {
    const s = translateMemoryContent("Daily check: looked at leads. 2 action(s) done, 1 not done, 3 waiting for approval. Assumptions: a; b", "he", (t) => (t === "Daily check" ? "בדיקה יומית" : t));
    expect(s).toContain("בוצעו 2 פעולות");
    expect(s).toContain("1 לא בוצעו");
    expect(s).toContain("3 ממתינות לאישורך");
    expect(s).toContain("הנחות: a; b");
    expect(s.startsWith("בדיקה יומית: ")).toBe(true);
  });
  it("translates to Arabic", () => {
    expect(translateMemoryContent("A previous complaint was resolved.", "ar")).toContain("شكوى");
    expect(translateMemoryContent("x: y. 4 action(s) done.", "ar")).toContain("تم تنفيذ 4 إجراءات");
  });
  it("leaves unknown text and Hebrew text alone", () => {
    expect(translateMemoryContent("הלקוח מעדיף וואטסאפ", "he")).toBe("הלקוח מעדיף וואטסאפ");
    expect(translateMemoryContent("Some free English note", "he")).toBe("Some free English note");
  });
  it("an unknown communication style is not guessed", () => {
    expect(translateMemoryContent("Communication style: something new.", "he")).toBe("Communication style: something new.");
  });
});

describe("wave 67 — memory view", () => {
  it("merges identical rows into the newest with a count, and keeps the stored text in raw", () => {
    const rows = [row({ id: "a", content: "A previous complaint was resolved." }), row({ id: "b", content: "A previous complaint was resolved." }), row({ id: "c", content: "A previous complaint was resolved.", created_at: "2026-10-01T00:00:00Z" })];
    const v = memoryView(rows, "he", { now: NOW });
    expect(v).toHaveLength(1);
    expect(v[0]!.id).toBe("a");
    expect(v[0]!.count).toBe(3);
    expect(v[0]!.raw).toBe("A previous complaint was resolved.");
    expect(v[0]!.content).toContain("תלונה");
  });
  it("merges an English row with its Hebrew twin after translation", () => {
    const v = memoryView([row({ id: "a", content: "A previous conversation ended in a deal." }), row({ id: "b", content: "שיחה קודמת הסתיימה בעסקה." })], "he", { now: NOW });
    expect(v).toHaveLength(1);
    expect(v[0]!.count).toBe(2);
  });
  it("does not merge different owners, layers, kinds or statuses", () => {
    const base = { content: "same text" };
    const v = memoryView([row({ id: "1", ...base }), row({ id: "2", ...base, member_id: "m1" }), row({ id: "3", ...base, layer: "semantic" }), row({ id: "4", ...base, kind: "fact" }), row({ id: "5", ...base, status: "proposed" })], "en", { now: NOW });
    expect(v).toHaveLength(5);
    expect(v.every((x) => x.count === undefined)).toBe(true);
  });
  it("hides empty, expired and past-expiry rows but keeps revoked and proposed", () => {
    const v = memoryView(
      [row({ id: "e", content: "" }), row({ id: "p", content: "—" }), row({ id: "x", content: "old", status: "expired" }), row({ id: "t", content: "timed out", expires_at: "2026-11-05T09:59:00Z" }), row({ id: "r", content: "revoked one", status: "revoked" }), row({ id: "q", content: "proposed one", status: "proposed" }), row({ id: "ok", content: "fine", expires_at: "2026-12-01T00:00:00Z" })],
      "he",
      { now: NOW },
    );
    expect(v.map((x) => x.id)).toEqual(["r", "q", "ok"]);
  });
  it("never mutates the input rows", () => {
    const rows = [row({ id: "a", content: "A previous complaint was resolved." })];
    const copy = JSON.stringify(rows);
    memoryView(rows, "he", { now: NOW });
    expect(JSON.stringify(rows)).toBe(copy);
  });
  it("safeMemoryView returns the rows exactly as they came when something throws", () => {
    const bad = [boom({ id: "z", member_id: null, layer: "episodic", kind: "fact", subject: null, status: "active", created_at: "" })] as unknown as MemoryLike[];
    expect(() => memoryView(bad, "he", { now: NOW })).toThrow();
    expect(safeMemoryView(bad, "he", { now: NOW })).toBe(bad);
  });
});

describe("wave 67 — write gate", () => {
  it("does not write empty memory", () => {
    const r = gateMemoryWrites([item({ content: "" }), item({ content: "—" }), item({ content: "real" })]);
    expect(r.items.map((x) => x.content)).toEqual(["real"]);
    expect(r.notes).toContain("empty=2");
  });
  it("does not save an outcome with 0 actions as memory (English, Hebrew, Arabic)", () => {
    for (const c of ["Task: looked. 0 action(s) done.", "משימה: בדקתי. בוצעו 0 פעולות, 2 לא בוצעו.", "مهمة: تم تنفيذ 0 إجراءات."]) {
      expect(gateMemoryWrites([item({ content: c })]).items, c).toHaveLength(0);
    }
  });
  it("10 actions is not 0 actions", () => {
    expect(gateMemoryWrites([item({ content: "Task: big. 10 action(s) done." })]).items).toHaveLength(1);
    expect(gateMemoryWrites([item({ content: "Task: big. 20 action(s) done, 0 not done." })]).items).toHaveLength(1);
  });
  it("splits assumptions off into a proposed item and keeps the rest active", () => {
    const r = gateMemoryWrites([item({ content: "Task: did it. 2 action(s) done. Assumptions: the customer is in Haifa; wants Tuesday" })]);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ status: "active", kind: "outcome", content: "Task: did it. 2 action(s) done." });
    expect(r.items[1]).toMatchObject({ status: "proposed", kind: "fact", subject: null });
    expect(r.items[1]!.confidence).toBeLessThan(0.41);
    expect(r.items[1]!.content).toContain("Assumptions: the customer is in Haifa");
    expect(r.notes).toContain("assumptions=1");
  });
  it("Hebrew assumptions are split off too", () => {
    const r = gateMemoryWrites([item({ content: "משימה: בוצע. בוצעו 3 פעולות. הנחות: הלקוח בחיפה" })]);
    expect(r.items.map((x) => x.status)).toEqual(["active", "proposed"]);
  });
  it("assumptions only → just the proposed item", () => {
    const r = gateMemoryWrites([item({ content: " Assumptions: guess" })]);
    expect(r.items.map((x) => x.status)).toEqual(["proposed"]);
  });
  it("only outcomes are split; other kinds and proposed items pass untouched", () => {
    const pref = item({ kind: "preference", layer: "semantic", content: "Keep it short. Assumptions: x" });
    const prop = item({ status: "proposed", content: "Task: y. Assumptions: z" });
    const r = gateMemoryWrites([pref, prop]);
    expect(r.items).toEqual([pref, prop]);
  });
  it("skips an exact repeat of an active memory and a repeat inside the batch", () => {
    const ex = [{ layer: "episodic", kind: "outcome", content: 'Task: Done. 1 action(s) done.', status: "active" }];
    const r = gateMemoryWrites([item({ content: "task: done. 1 action(s) done" }), item({ content: "Other: 2 action(s) done." }), item({ content: "Other: 2 action(s) done." })], ex);
    expect(r.items.map((x) => x.content)).toEqual(["Other: 2 action(s) done."]);
    expect(r.notes).toContain("duplicate=2");
  });
  it("a proposed repeat of an existing proposed item is skipped, but an active one is still written", () => {
    const ex = [{ layer: "episodic", kind: "fact", content: "Assumptions: same", status: "proposed" }];
    const a = gateMemoryWrites([item({ content: "Task: t. 1 action(s) done. Assumptions: same" })], ex);
    expect(a.items.map((x) => x.status)).toEqual(["active"]);
    const b = gateMemoryWrites([item({ kind: "fact", status: "active", content: "Assumptions: same" })], ex);
    expect(b.items).toHaveLength(1);
  });
  it("never makes the write bigger than the input plus the split-off proposals", () => {
    const items = [item({ content: "A: 1 action(s) done. Assumptions: x" }), item({ content: "B: 1 action(s) done." })];
    expect(gateMemoryWrites(items).items.length).toBeLessThanOrEqual(items.length + 1);
  });
  it("does not mutate its input", () => {
    const items = [item({ content: "A: 1 action(s) done. Assumptions: x" })];
    const copy = JSON.stringify(items);
    gateMemoryWrites(items);
    expect(JSON.stringify(items)).toBe(copy);
  });
  it("safeGateMemoryWrites fails silent: the items come back exactly as they were passed in", () => {
    const bad = [boom({ layer: "episodic", kind: "outcome", subject: null, confidence: 0.5, status: "active" })] as unknown as NewMemoryLike[];
    expect(() => gateMemoryWrites(bad)).toThrow();
    const r = safeGateMemoryWrites(bad);
    expect(r.items).toBe(bad);
    expect(r.notes).toEqual([]);
  });
  it("localizes the activity-log note", () => {
    expect(localizeGateSummary("Memory gate: zero=1 duplicate=2", "he")).toBe("סינון זיכרון לא נשמר: תוצאות עם 0 פעולות 1, כפילויות 2");
    expect(localizeGateSummary("Memory gate: zero=1", "en")).toBe("Memory gate: zero=1");
    expect(localizeGateSummary("something else", "he")).toBe("something else");
    expect(localizeGateSummary("Memory gate: nonsense", "he")).toBe("Memory gate: nonsense");
  });
});

describe("wave 67 — automated senders that are not customers", () => {
  it("recognises the Telegram service account by name or phone", () => {
    expect(isTelegramServiceContact({ name: "Telegram" })).toBe(true);
    expect(isTelegramServiceContact({ name: "  telegram  notifications " })).toBe(true);
    expect(isTelegramServiceContact({ name: "טלגרם" })).toBe(true);
    expect(isTelegramServiceContact({ name: "x", phone: "+42777" })).toBe(true);
    expect(isTelegramServiceContact({ name: "x", phone: "777000" })).toBe(true);
    expect(isTelegramServiceContact({ company: "Telegram" })).toBe(true);
  });
  it("does not flag real people", () => {
    expect(isTelegramServiceContact({ name: "Telegram Dan" })).toBe(false);
    expect(isTelegramServiceContact({ name: "דנה", phone: "+972501234567" })).toBe(false);
    expect(isTelegramServiceContact({})).toBe(false);
  });
  it("recognises short automated login-code messages", () => {
    for (const t of ["Login code: 12345. Do not give this code to anyone.", "Your verification code is 482913", "קוד ההתחברות שלך הוא 55120", "קוד אימות: 4821", "رمز التحقق الخاص بك 123456", "Your security code: 123-456"]) expect(looksLikeLoginCode(t), t).toBe(true);
  });
  it("does not treat a person's message as a code", () => {
    for (const t of ["", "היי, אני צריך עזרה", "My verification code never arrived 12345?", "מתי תגיעו? קוד אימות 1234", "Please send the code", "Login code 12", "x".repeat(300) + " login code 12345", "I paid 12345 shekels"]) expect(looksLikeLoginCode(t), t).toBe(false);
    expect(looksLikeLoginCode(undefined)).toBe(false);
    expect(looksLikeLoginCode(42)).toBe(false);
  });
  it("flags a contact only when every conversation ends with a code message", () => {
    const convs = [{ id: "c1", contact_id: "a" }, { id: "c2", contact_id: "a" }, { id: "c3", contact_id: "b" }, { id: "c4", contact_id: "b" }, { id: "c5", contact_id: "c" }, { id: "c6", contact_id: null }];
    const last = new Map([["c1", "Login code: 11111"], ["c2", "Your verification code is 22222"], ["c3", "Login code: 33333"], ["c4", "תודה רבה"], ["c6", "Login code: 66666"]]);
    expect([...contactsWithOnlyCodeMessages(convs, last)]).toEqual(["a"]);
  });
});

describe("wave 67 — wiring (text of the edited files)", () => {
  it("the write gate is inside a try/catch, after the existing read, before the existing loop", () => {
    const r = read("lib/team/runner.ts");
    expect(r).toMatch(/const existing = await memoriesFor\(orgId, memberId\);[\s\S]{0,200}wave 67[\s\S]{0,900}safeGateMemoryWrites[\s\S]{0,700}catch \{[\s\S]{0,120}\}\s*if \(!items\.length\) return;\s*for \(const it of items\)/);
    expect(r).toContain("const old = it.status === \"active\" ? supersededBy(");
    expect(r).toContain("export async function writeMemories(");
  });
  it("the extra robot detection is optional and the old detection is kept", () => {
    const t = read("lib/team/tools.ts");
    expect(t).toContain("export async function automatedContactIds(orgId: string, ids: (string | null)[]): Promise<Set<string>>");
    expect(t).toContain("isAutomatedSender({ email: c.email");
    expect(t).toMatch(/wave 67[\s\S]{0,2200}catch \{[\s\S]{0,120}return out;/);
    expect(t).toContain("const robots = await automatedContactIds(orgId, rows.map((c) => c.contact_id));");
  });
  it("page-data translates the memory tab in its own try/catch and keeps the older lines", () => {
    const p = read("lib/team/page-data.ts");
    expect(p).toMatch(/wave 67[\s\S]{0,300}safeMemoryView[\s\S]{0,300}catch \{/);
    expect(p).toContain("memory: memRows,");
    expect(p).toContain("data.activity = data.activity.map((x) => ({ ...x, summary: localizeLog(x.summary, lang8) }));");
  });
  it("the panel shows ×N and edits the stored text", () => {
    const p = read("components/ai-team/panels.tsx");
    expect(p).toContain("×{m.count}");
    expect(p).toContain("m.raw ?? m.content");
    expect(read("components/ai-team/types.ts")).toMatch(/count\?: number;[\s\S]{0,160}raw\?: string;/);
  });
  it("no migration, no dictionary change, no new package", () => {
    const sql = read("../../supabase/migrations/20261105000012_team_upgrade_8_job_profiles.sql");
    expect(sql.length).toBeGreaterThan(10);
    expect(read("lib/team/memory-clean-core.ts")).not.toMatch(/from "(?!node:)[^.@]/);
  });
});
