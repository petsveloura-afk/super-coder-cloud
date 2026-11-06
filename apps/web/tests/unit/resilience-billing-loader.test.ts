import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_JSON_MODE, ROUTE_PROVIDERS, buildCandidates, extraEngines, keysFor, providerKeys } from "@/lib/ai/router-core";
import { busyWaitCaps, busyWaitMs, secondPassBudget } from "@/lib/ai/busy-wait-core";
import { localizeLog } from "@/lib/team/title-i18n-core";
import { AUTO_FIXABLE, billingFlags, summarize, type BillingHealthRow } from "@/lib/billing/integrity-core";
import { receiptItemHe } from "@/lib/billing/receipts";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const K = (n: number, c = "a") => `${c}${"x".repeat(28)}${n}`;

describe("AI resilience — more engines, more keys, no stall on a short wait", () => {
  it("existing engines keep their places; three free engines + custom engines join before the paid ones", () => {
    expect(ROUTE_PROVIDERS.slice(0, 5)).toEqual(["groq", "cerebras", "gemini", "openrouter", "mistral"]);
    expect(ROUTE_PROVIDERS.slice(-2)).toEqual(["anthropic", "openai"]);
    expect(ROUTE_PROVIDERS).toEqual(expect.arrayContaining(["together", "cohere", "zhipu", "custom"]));
    expect(ROUTE_PROVIDERS.indexOf("huggingface")).toBeLessThan(ROUTE_PROVIDERS.indexOf("together"));
    expect(NO_JSON_MODE).toEqual(expect.arrayContaining(["cloudflare", "huggingface", "sambanova", "custom"]));
  });

  it("up to 30 numbered keys per engine (was 10) + the comma list, de-duplicated", () => {
    const env: Record<string, string> = { GROQ_API_KEY: K(1), GROQ_API_KEYS: `${K(1)},${K(40)}` };
    for (let i = 2; i <= 30; i++) env[`GROQ_API_KEY_${i}`] = K(i);
    const keys = keysFor(env, "GROQ_API_KEY");
    expect(keys).toHaveLength(31);
    expect(keys).toContain(K(30));
    expect(providerKeys("together", { TOGETHER_API_KEY: K(1, "t") })).toHaveLength(1);
    expect(providerKeys("zhipu", {})).toEqual([]);
  });

  it("custom OpenAI-compatible engines from AI_EXTRA_ENGINES (bad entries are ignored, keys stay in their own variable)", () => {
    const env = {
      AI_EXTRA_ENGINES: "chutes|https://llm.chutes.ai/v1|deepseek-v3;qwen-3|CHUTES_API_KEY, bad|http://insecure|m|X_KEY, nokey|https://x.ai/v1|m|MISSING_KEY",
      CHUTES_API_KEY: "fake-test-key-one",
      CHUTES_API_KEY_2: "fake-test-key-two",
    };
    const e = extraEngines(env);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ name: "chutes", baseUrl: "https://llm.chutes.ai/v1", models: ["deepseek-v3", "qwen-3"] });
    expect(e[0]!.keys).toHaveLength(2);
    const c = buildCandidates({ env, random: () => 0 }).filter((x) => x.provider === "custom");
    expect(c).toHaveLength(4);
    expect(c[0]).toMatchObject({ model: "deepseek-v3", baseUrl: "https://llm.chutes.ai/v1" });
    expect(c[0]!.keyId.startsWith("custom-chutes:")).toBe(true);
    // nothing configured → nothing added (old setups unchanged)
    expect(buildCandidates({ env: { GROQ_API_KEY: K(1) }, random: () => 0 }).every((x) => x.provider === "groq")).toBe(true);
  });

  it("busy for a moment → wait exactly that long and make ONE more pass; never for long waits or other errors", () => {
    expect(busyWaitCaps({})).toEqual({ interactive: 5000, background: 15000, total: 38000 });
    expect(busyWaitMs({ busy: true, retryInMs: 6000, lane: "background", elapsedMs: 5000 })).toBe(6400);
    expect(busyWaitMs({ busy: true, retryInMs: 0, lane: "interactive", elapsedMs: 2000 })).toBe(400);
    expect(busyWaitMs({ busy: true, retryInMs: 6000, lane: "interactive", elapsedMs: 2000 })).toBe(0);
    expect(busyWaitMs({ busy: true, retryInMs: 90_000, lane: "background", elapsedMs: 0 })).toBe(0);
    expect(busyWaitMs({ busy: false, retryInMs: 1000, lane: "background", elapsedMs: 0 })).toBe(0);
    expect(busyWaitMs({ busy: true, retryInMs: null, lane: "background", elapsedMs: 0 })).toBe(0);
    // no room left for a second pass inside the function time
    expect(busyWaitMs({ busy: true, retryInMs: 5000, lane: "background", elapsedMs: 30_000 })).toBe(0);
    expect(busyWaitMs({ busy: true, retryInMs: 1000, lane: "background", elapsedMs: 0 }, { AI_BUSY_WAIT_MS: "0" })).toBe(0);
    expect(secondPassBudget(5000, 6400)).toBe(20_000);
    expect(secondPassBudget(25_000, 3000)).toBe(10_000);
  });

  it("wiring: both metered paths wait-and-retry, the admin screen names the new engines, .env documents them", () => {
    for (const f of ["lib/ai/run.ts", "lib/ai/run-system.ts"]) {
      const s = read(f);
      expect(s, f).toContain("busyWaitMs(");
      expect(s, f).toContain("secondPassBudget(");
      expect(s, f).toContain("if (!(e instanceof RouterError)) throw e;");
    }
    const h = read("components/admin/ai-health.tsx");
    for (const k of ["together:", "cohere:", "zhipu:", "custom:"]) expect(h).toContain(k);
    const env = readFileSync(join(root, "../../.env.example"), "utf8");
    for (const k of ["TOGETHER_API_KEY=", "COHERE_API_KEY=", "ZHIPU_API_KEY=", "AI_EXTRA_ENGINES=", "AI_BUSY_WAIT_MS="]) expect(env).toContain(k);
  });

  it("team log lines that stayed English are shown in Hebrew / Arabic; an empty decision shows what was understood", () => {
    expect(localizeLog("The first answer was unreadable — the second attempt worked.", "he")).toBe("התשובה הראשונה לא הייתה קריאה — הניסיון השני הצליח.");
    expect(localizeLog("Could not write the output (AI busy).", "ar")).toContain("تعذّرت");
    expect(localizeLog("goal: read all reviews", "he")).toBe("מטרה: read all reviews");
    expect(localizeLog("The first answer was unreadable — the second attempt worked.", "en")).toBe("The first answer was unreadable — the second attempt worked.");
    expect(read("lib/team/engine-plus7.ts")).toContain("(draft.decided || draft.understood || o.task.title || \"\")");
  });
});

const row = (o: Partial<BillingHealthRow>): BillingHealthRow => ({
  organization_id: "o",
  name: "Biz",
  owner_email: null,
  plan: "free",
  is_demo: false,
  sub_plan: null,
  sub_status: null,
  sub_provider: null,
  period_end: null,
  cancel_at_period_end: false,
  paid_total: 0,
  paid_currency: null,
  payments: 0,
  last_paid_at: null,
  credits_month: 0,
  monthly_limit: 50,
  pack_balance: 0,
  ...o,
});

describe("billing integrity — payers get their plan, non-payers never keep one", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("flags", () => {
    expect(billingFlags(row({}), now)).toEqual([]);
    expect(billingFlags(row({ plan: "free", sub_plan: "pro", sub_status: "active", sub_provider: "paypal", payments: 1, period_end: "2026-12-01T00:00:00Z" }), now)).toEqual(["paid_no_access"]);
    expect(billingFlags(row({ plan: "pro", sub_plan: "pro", sub_status: "canceled", sub_provider: "paypal", payments: 2 }), now)).toEqual(["access_no_payment"]);
    expect(billingFlags(row({ plan: "pro", sub_plan: "pro", sub_status: "past_due", sub_provider: "paypal", payments: 1 }), now)).toEqual(["past_due"]);
    expect(billingFlags(row({ plan: "pro", sub_plan: "pro", sub_status: "active", sub_provider: "lemonsqueezy", payments: 1, period_end: "2026-11-01T00:00:00Z" }), now)).toEqual(["period_passed"]);
    expect(billingFlags(row({ plan: "pro", sub_plan: "pro", sub_status: "active", sub_provider: "paypal", period_end: "2026-12-01T00:00:00Z" }), now)).toEqual(["no_receipts"]);
    // a hand-granted plan needs no receipt; a demo business is never flagged for payment
    expect(billingFlags(row({ plan: "pro", sub_plan: "pro", sub_status: "active", sub_provider: "manual" }), now)).toEqual([]);
    expect(billingFlags(row({ plan: "business", is_demo: true }), now)).toEqual([]);
    expect(billingFlags(row({ credits_month: 60, monthly_limit: 50, pack_balance: 0 }), now)).toEqual(["over_limit"]);
    expect(billingFlags(row({ credits_month: 60, monthly_limit: 50, pack_balance: 100 }), now)).toEqual([]);
    expect(AUTO_FIXABLE).toEqual(["paid_no_access", "past_due", "period_passed"]);
    const s = summarize([row({}), row({ plan: "pro", sub_status: "canceled", sub_plan: "pro" }), row({ plan: "free", sub_plan: "pro", sub_status: "active" })], now);
    expect(s).toMatchObject({ total: 3, paying: 1, issues: 2, fixable: 1 });
  });

  it("every receipt names what was bought (plan / credit pack / domain)", () => {
    expect(receiptItemHe({ plan: "pro", interval: "year" })).toBe("Pro · שנתי");
    expect(receiptItemHe({ meta: { credit_pack: "x", credits: 5000 } })).toBe("חבילת קרדיטים ל-AI · 5,000 קרדיטים");
    expect(receiptItemHe({ meta: { domain: "shop.co.il" } })).toBe("דומיין · shop.co.il");
  });

  it("wiring: one payment = one receipt, domains get receipts, the sweep runs the check, the admin card + client file", () => {
    const r = read("lib/billing/receipts.ts");
    expect(r).toContain("const twin = await findTwinPayment(p)");
    expect(r).toContain("completePayment(p0)");
    expect(read("lib/site/domains.ts")).toContain("meta: { domain: base.domain, domain_order: row.id }");
    const sweep = read("app/api/billing/sweep/route.ts");
    expect(sweep).toContain('admin.rpc("billing_integrity_sweep")');
    expect(sweep).toContain("syncPayPalSubscription(s.provider_subscription_id)");
    expect(read("app/[locale]/(dashboard)/admin/page.tsx")).toContain("<AdminBillingHealth locale={locale} />");
    expect(read("app/[locale]/(wide)/receipt/[id]/page.tsx")).toContain('t("billing.pay.itemCredits"');
    const sql = readFileSync(join(root, "../../supabase/migrations/20261106000003_billing_integrity.sql"), "utf8");
    for (const fn of ["billing_integrity_sweep()", "admin_billing_integrity_sweep()", "platform_billing_health(", "platform_billing_file("]) expect(sql).toContain(fn);
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const f of ["paid_no_access", "access_no_payment", "past_due", "period_passed", "no_receipts", "over_limit"]) expect(typeof d.admin.billingHealth.flag[f], `${l}.${f}`).toBe("string");
      for (const st of ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid"]) expect(typeof d.admin.billingHealth.status[st]).toBe("string");
      for (const a of ["plan_changed", "plan_restored", "payment"]) expect(typeof d.admin.billingHealth.action[a]).toBe("string");
      expect(typeof d.billing.pay.itemCredits).toBe("string");
      expect(typeof d.billing.pay.itemDomain).toBe("string");
    }
  });
});

describe("site agent loader — an animated scene while the agent builds or edits", () => {
  it("both the new-site card and the AI editor show it; working → done → the site, or error → try again", () => {
    const card = read("components/websites/ai-site-card.tsx");
    expect(card).toContain('<SiteAgentLoader phase={phase} mode="build"');
    expect(card).toContain('setPhase("done");');
    expect(card).toContain('setPhase("error");');
    expect(card).toContain("router.push(`/${locale}/websites/${r.data.id}/preview`)");
    const edit = read("components/websites/ai-edit-panel.tsx");
    expect(edit).toContain('<SiteAgentLoader phase={phase} mode="edit"');
    expect(edit).toContain("onRetry={lastInstruction ? () => run(lastInstruction) : undefined}");
    const l = read("components/websites/site-agent-loader.tsx");
    expect(l).toContain('data-testid="site-agent-loader"');
    expect(l).toContain("createPortal(");
    for (const k of ["titleBuild", "titleEdit", "doneBuild", "doneEdit", "showing", "errorTitle", "errorBody", "retry", "close", "hint"])
      for (const lang of ["he", "en", "ar"]) expect(typeof JSON.parse(read(`lib/i18n/dictionaries/${lang}.json`)).websites.agentLoader[k], `${lang}.${k}`).toBe("string");
  });

  it("CSS: transform / opacity only (never the translate property), layered, nothing when motion is reduced", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("site agent loader (additive)"));
    expect(block).toContain("@layer components {");
    expect(block).toContain("prefers-reduced-motion: no-preference");
    for (const k of ["sal-fade", "sal-card-in", "sal-spin", "sal-bob", "sal-build", "sal-burst"]) {
      const kf = block.match(new RegExp(`@keyframes ${k} \\{[^\\n]*\\}`))?.[0] ?? "";
      expect(kf, k).not.toBe("");
      expect(kf, k).not.toMatch(/\btranslate:/);
    }
  });
});
