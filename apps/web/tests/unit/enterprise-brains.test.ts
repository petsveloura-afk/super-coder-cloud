import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { proofsFromFacts, psychologyPlan, readObjections, salesPsychology, salesPsychologyBrief, sentimentLabel, sentimentScore, sentimentTrend } from "@/lib/ai/sales-psychology-core";
import { TtlCache } from "@/lib/cache/ttl-cache-core";
import { backoffDelay, isTransientDbError, nextRetryDelay } from "@/lib/db/resilient-core";
import { withDbRetry } from "@/lib/db/resilient";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const u = (content: string) => ({ role: "user" as const, content });
const a = (content: string) => ({ role: "assistant" as const, content });

describe("sales psychology — sentiment -1.0 … 1.0", () => {
  it("scores clear moods in Hebrew, English and Arabic", () => {
    expect(sentimentScore("מעולה, תודה רבה! 🙏")).toBeGreaterThan(0.5);
    expect(sentimentScore("נוכלים, אני אתבע אתכם")).toBeLessThan(-0.6);
    expect(sentimentScore("This is amazing, thank you")).toBeGreaterThan(0.5);
    expect(sentimentScore("worst service ever, total scam")).toBeLessThan(-0.6);
    expect(sentimentScore("شكرا جزيلا، ممتاز")).toBeGreaterThan(0.4);
    expect(sentimentScore("خدمة سيئة ومشكلة كبيرة")).toBeLessThan(-0.3);
  });

  it("neutral text is 0, and the score always stays inside [-1, 1]", () => {
    expect(sentimentScore("מה שעות הפתיחה?")).toBe(0);
    expect(sentimentScore("")).toBe(0);
    const extreme = sentimentScore("נוכלים רמאים גנבים עוקץ בושה זבל 😡😡😡 SCAM FRAUD WORST!!!");
    expect(extreme).toBeGreaterThanOrEqual(-1);
    expect(extreme).toBeLessThan(-0.8);
  });

  it("negation flips, intensifiers strengthen", () => {
    expect(sentimentScore("not good")).toBeLessThan(0);
    expect(sentimentScore("לא מעולה")).toBeLessThan(0);
    expect(sentimentScore("very good")).toBeGreaterThan(sentimentScore("good"));
  });

  it("labels and trend over the conversation", () => {
    expect(sentimentLabel(-0.9)).toBe("very_negative");
    expect(sentimentLabel(0)).toBe("neutral");
    expect(sentimentLabel(0.8)).toBe("very_positive");
    const declining = sentimentTrend([u("מעולה תודה"), a("בשמחה"), u("אני מאוכזב, זה לא עובד")]);
    expect(declining.trend).toBe("declining");
    const improving = sentimentTrend([u("אני מאוכזב מאוד"), a("סליחה, אני מטפל"), u("מעולה, תודה רבה!")]);
    expect(improving.trend).toBe("improving");
    expect(sentimentTrend([]).label).toBe("neutral");
  });
});

describe("sales psychology — deep objections and adaptive tactics", () => {
  it("an objection raised again is deep", () => {
    const r = readObjections([u("זה יקר לי"), a("הנה מה שמקבלים…"), u("עדיין יקר מדי")]);
    expect(r.now).toContain("price");
    expect(r.deep).toContain("price");
    expect(readObjections([u("זה יקר")]).deep).toEqual([]);
  });

  it("an upset customer gets empathy, never a sale", () => {
    const p = psychologyPlan({ history: [u("אתם נוכלים, אני רוצה החזר עכשיו 😡")] });
    expect(p.tactics[0]).toBe("empathy_first");
    expect(p.tactics).not.toContain("urgency_framing");
    expect(p.tactics).not.toContain("assumptive_next_step");
  });

  it("price → value anchoring; risk reversal only when the business really has a guarantee", () => {
    const noProof = psychologyPlan({ history: [u("זה יקר")] });
    expect(noProof.tactics[0]).toBe("value_anchoring");
    expect(noProof.tactics).not.toContain("risk_reversal");
    const withProof = psychologyPlan({ history: [u("too expensive")], proofs: { riskReversal: true } });
    expect(withProof.tactics).toContain("risk_reversal");
  });

  it("trust → social proof only with real proof; urgency only with a real deadline", () => {
    expect(psychologyPlan({ history: [u("can i trust you? any reviews?")] }).tactics).not.toContain("social_proof");
    expect(psychologyPlan({ history: [u("can i trust you? any reviews?")], proofs: { socialProof: true } }).tactics).toContain("social_proof");
    expect(psychologyPlan({ history: [u("אחשוב על זה")] }).tactics).not.toContain("urgency_framing");
    expect(psychologyPlan({ history: [u("אחשוב על זה")], proofs: { realUrgency: true } }).tactics).toContain("urgency_framing");
  });

  it("a ready customer gets the next step", () => {
    const p = psychologyPlan({ history: [u("סגור, תרשום אותי. אפשר לשלם באשראי?")] });
    expect(p.tactics).toContain("assumptive_next_step");
  });

  it("proofs are read from the business facts", () => {
    expect(proofsFromFacts("10 שנות ניסיון, מאות לקוחות מרוצים")).toMatchObject({ socialProof: true });
    expect(proofsFromFacts("30 day money-back guarantee")).toMatchObject({ riskReversal: true });
    expect(proofsFromFacts("מבצע עד 30.11, מקומות מוגבלים")).toMatchObject({ realUrgency: true });
    expect(proofsFromFacts("מספרה בתל אביב")).toEqual({ socialProof: false, riskReversal: false, realUrgency: false });
  });

  it("the brief is short, carries the score and the honesty rule, and never throws", () => {
    const brief = salesPsychologyBrief(psychologyPlan({ history: [u("יקר"), a("…"), u("עדיין יקר")] }));
    expect(brief).toContain("SALES PSYCHOLOGY");
    expect(brief).toContain("DEEP objection");
    expect(brief).toContain("Honesty is absolute");
    expect(brief.length).toBeLessThan(1500);
    expect(salesPsychology({ history: null as never }).brief).toContain("SALES PSYCHOLOGY");
  });

  it("is wired into the conversation agent's brief (additive, never blocking)", () => {
    const src = read("lib/ai/autopilot.ts");
    expect(src).toContain('await import("./sales-psychology-core")');
    expect(src).toContain("${proBrief({ text: lastIn, history })}${psychologySection}");
    expect(src).toMatch(/let psychologySection = "";\s*try \{/);
  });
});

describe("fast context cache — LRU + TTL + single-flight", () => {
  it("hits within the TTL, misses after it", async () => {
    let t = 0;
    const c = new TtlCache(10, () => t);
    let loads = 0;
    const load = async () => ++loads;
    expect(await c.getOrLoad("k", 1000, load)).toBe(1);
    expect(await c.getOrLoad("k", 1000, load)).toBe(1);
    t = 1001;
    expect(await c.getOrLoad("k", 1000, load)).toBe(2);
    expect(c.snapshot().hits).toBe(1);
  });

  it("concurrent callers share ONE load; a failed load is not cached", async () => {
    const c = new TtlCache();
    let loads = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++loads), 20));
    const all = await Promise.all([c.getOrLoad("x", 1000, slow), c.getOrLoad("x", 1000, slow), c.getOrLoad("x", 1000, slow)]);
    expect(all).toEqual([1, 1, 1]);
    expect(loads).toBe(1);
    await expect(c.getOrLoad("bad", 1000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await c.getOrLoad("bad", 1000, async () => 7)).toBe(7);
  });

  it("evicts the least recently used entry and invalidates by prefix", () => {
    const c = new TtlCache(2);
    c.set("a", 1, 1000);
    c.set("b", 2, 1000);
    c.get("a");
    c.set("c", 3, 1000);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    c.set("ap:1", 1, 1000);
    expect(c.invalidate("ap:*")).toBe(1);
  });

  it("the agent caches only business-level facts (never conversation state)", () => {
    const src = read("lib/ai/autopilot.ts");
    expect(src).toContain("cached(`ap:canBook:${orgId}`, 30_000");
    expect(src).toContain("cached(`ap:canPay:${orgId}`, 30_000");
    expect(src).not.toMatch(/cached\(`[^`]*(?:guard|ai_mode|opted|messages)/);
    const l2 = read("lib/cache/ttl-cache.ts");
    expect(l2).toContain("L2_TIMEOUT_MS = 250");
    expect(l2).toContain("UPSTASH_REDIS_REST_URL");
  });
});

describe("resilient database calls — transient errors retry with backoff", () => {
  it("classifies transient vs permanent errors", () => {
    expect(isTransientDbError({ code: "40001", message: "could not serialize" })).toBe(true);
    expect(isTransientDbError({ code: "PGRST003" })).toBe(true);
    expect(isTransientDbError({ message: "TypeError: fetch failed" })).toBe(true);
    expect(isTransientDbError({ status: 503, message: "Service Unavailable" })).toBe(true);
    expect(isTransientDbError({ code: "23505", message: "duplicate key value — connection reset" })).toBe(false);
    expect(isTransientDbError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it("backoff grows exponentially with full jitter, capped", () => {
    expect(backoffDelay(0, { baseMs: 100 }, () => 1)).toBe(100);
    expect(backoffDelay(3, { baseMs: 100 }, () => 1)).toBe(800);
    expect(backoffDelay(10, { baseMs: 100, maxMs: 2000 }, () => 1)).toBe(2000);
    expect(backoffDelay(2, { baseMs: 100 }, () => 0)).toBe(0);
    expect(nextRetryDelay({ attempt: 2, maxAttempts: 3, error: { code: "40001" }, elapsedMs: 0, budgetMs: 5000 })).toBeNull();
    expect(nextRetryDelay({ attempt: 0, maxAttempts: 3, error: { code: "23505" }, elapsedMs: 0, budgetMs: 5000 })).toBeNull();
  });

  it("withDbRetry retries a transient Supabase error and returns the good result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let n = 0;
    const r = await withDbRetry(async () => (++n < 3 ? { data: null, error: { message: "fetch failed" } } : { data: "ok", error: null }), { baseMs: 1, maxMs: 2 });
    expect(r).toEqual({ data: "ok", error: null });
    expect(n).toBe(3);
  });

  it("withDbRetry never retries a permanent error, and re-throws the last transient throw", async () => {
    let n = 0;
    const perm = await withDbRetry(async () => {
      n++;
      return { data: null, error: { code: "23505", message: "duplicate" } };
    });
    expect(n).toBe(1);
    expect(perm.error).toMatchObject({ code: "23505" });
    let m = 0;
    await expect(
      withDbRetry(
        async () => {
          m++;
          throw new Error("ECONNRESET");
        },
        { attempts: 2, baseMs: 1 },
      ),
    ).rejects.toThrow("ECONNRESET");
    expect(m).toBe(2);
  });

  it("the credit grant and the agent's history read are wrapped (both idempotent)", () => {
    expect(read("lib/billing/packs.ts")).toContain('withDbRetry(() => admin.rpc("grant_credit_purchase"');
    expect(read("lib/ai/autopilot.ts")).toContain('label: "autopilot.history"');
  });
});

describe("live campaign progress", () => {
  it("refreshes while sending, only when visible, and stops by itself", () => {
    const src = read("components/campaigns/campaign-live.tsx");
    expect(src).toContain('status === "sending"');
    expect(src).toContain('document.visibilityState === "visible"');
    expect(src).toContain("30 * 60_000");
    expect(read("app/[locale]/(dashboard)/campaigns/[id]/page.tsx")).toContain("<CampaignLive status=");
    for (const l of ["he", "en", "ar"]) expect((JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { campaigns: { live?: string } }).campaigns.live).toBeTruthy();
  });
});

describe("sales psychology — Hebrew word boundaries", () => {
  it("short stems never match inside other words", () => {
    expect(sentimentScore("יש לי רעיון לשיתוף פעולה")).toBe(0);
    expect(sentimentScore("ביקרתי אצלכם אתמול")).toBe(0);
    expect(sentimentScore("זה יקר")).toBeLessThan(0);
    expect(sentimentScore("והמחיר יקר מדי, חבל")).toBeLessThan(0);
    expect(sentimentScore("ותודה רבה")).toBeGreaterThan(0);
  });
});
