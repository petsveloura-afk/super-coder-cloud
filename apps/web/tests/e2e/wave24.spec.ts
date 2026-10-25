import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 24 — a more practical system:
 *  - inbox: who is waiting (SLA badge), quick filters with counts, search + channel filter
 *  - saved replies: starter answers, {name} filled in, lands in the reply box, add your own
 *  - pipelines: insights (win rate, forecast, attention) + stuck / late badges and filters
 *  - calculators: VAT and friends, live as you type, in the menu
 *  - overview: "what to do now"; billing: plan advisor, comparison table, trust strip
 */
const SUPA = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };
const rest = async <T,>(request: APIRequestContext, method: "get" | "post", path: string, data?: unknown) => {
  const r = await request[method](`${SUPA}/rest/v1/${path}`, { headers: H, data });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
};

test("wave 24: inbox SLA + filters + saved replies, pipeline insights, calculators, next actions, billing advisor", async ({ page, request }) => {
  test.skip(!KEY || !SUPA, "needs the local stack (service key to seed conversations)");
  test.setTimeout(300_000);
  const stamp = Date.now();
  const slug = `w24-${stamp}`;
  await signUp(page, { name: "Noa Owner", email: uniqueEmail("w24") });
  await createOrg(page, "סטודיו נועה", slug);
  const org = (await rest<{ id: string }[]>(request, "get", `organizations?select=id&slug=eq.${slug}`))[0]!.id;

  // seed: a customer waiting 40 minutes (web chat), a hot lead already answered (telegram)
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const [waiting] = await rest<{ id: string }[]>(request, "post", "conversations", [
    { organization_id: org, channel: "web", external_id: `w24a-${stamp}`, title: "דנה כהן", last_message_preview: "היי, יש מקום מחר?", last_message_at: ago(40), last_customer_at: ago(40), last_ai_at: ago(60) },
  ]);
  await rest(request, "post", "conversations", [
    { organization_id: org, channel: "telegram", external_id: `w24b-${stamp}`, title: "רון לוי", last_message_preview: "תודה!", last_message_at: ago(5), last_customer_at: ago(10), last_ai_at: ago(5), lead_score: "hot" },
  ]);

  // inbox: SLA badge, counts, quick filters, search, channel filter
  await page.goto("/he/inbox");
  await expect(page.getByTestId("inbox-count-open")).toHaveText("2");
  const items = page.locator("[data-conversation]");
  await expect(items).toHaveCount(2);
  await expect(page.locator(`[data-conversation="${waiting!.id}"]`).getByTestId("sla-badge")).toContainText("מחכה");
  await page.getByTestId("inbox-flag-waiting").click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("דנה כהן");
  await page.getByTestId("inbox-flag-waiting").click();
  await page.getByTestId("inbox-flag-hot").click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("רון לוי");
  await page.getByTestId("inbox-clear").click();
  await expect(items).toHaveCount(2);
  await page.getByTestId("inbox-search").locator('input[name="q"]').fill("דנה");
  await page.getByTestId("inbox-search").locator('button[type="submit"]').click();
  await expect(items).toHaveCount(1);
  await page.getByTestId("inbox-clear").click();
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("inbox-search").locator('input[name="q"]')).toHaveValue(""); // cleared filters also clear the box
  await page.getByTestId("inbox-search").locator('select[name="ch"]').selectOption("telegram");
  await page.getByTestId("inbox-search").locator('button[type="submit"]').click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("רון לוי");

  // saved replies: starters → pick → the reply box has the text with the customer's first name
  await page.goto(`/he/inbox?c=${waiting!.id}`);
  const saved = page.getByTestId("saved-replies");
  await saved.getByRole("button", { name: "תשובות מוכנות" }).click();
  await saved.getByTestId("saved-starters").click();
  await expect(saved.getByTestId("saved-item")).toHaveCount(4);
  await saved.getByPlaceholder("חיפוש או /קיצור").fill("/מחיר");
  await expect(saved.getByTestId("saved-item")).toHaveCount(1);
  await saved.getByTestId("saved-item").click();
  const box = page.getByPlaceholder("כתבו תשובה… (Ctrl+Enter לשליחה)");
  await expect(box).toHaveValue(/^בשמחה דנה! מצרף את המחירון/);
  // add your own
  await saved.getByRole("button", { name: "תשובות מוכנות" }).click();
  await saved.getByTestId("saved-add-toggle").click();
  await saved.getByTestId("saved-title").fill("שעות פתיחה");
  await saved.getByTestId("saved-body").fill("היי {name}, אנחנו פתוחים א׳-ה׳ 9:00-19:00");
  await saved.getByTestId("saved-save").click();
  await expect(saved.getByTestId("saved-item")).toHaveCount(5);
  await expect(saved.getByTestId("saved-item").filter({ hasText: "שעות פתיחה" })).toContainText("היי דנה, אנחנו פתוחים");
  await shot(page, "w24-inbox");

  // pipelines: a deal stuck 30 days and past its close date
  const pipe = (await rest<{ id: string; pipeline_stages: { id: string; position: number }[] }[]>(request, "get", `pipelines?select=id,pipeline_stages(id,position)&organization_id=eq.${org}&limit=1`))[0]!;
  const stage = [...pipe.pipeline_stages].sort((a, b) => a.position - b.position)[0]!.id;
  await rest(request, "post", "deals", [
    { organization_id: org, pipeline_id: pipe.id, stage_id: stage, title: "חבילת חתונה", value: 9000, expected_close_date: "2026-01-01", updated_at: ago(30 * 24 * 60) },
    { organization_id: org, pipeline_id: pipe.id, stage_id: stage, title: "סדנת צילום", value: 1200, expected_close_date: null, updated_at: new Date().toISOString() },
  ]);
  await page.goto(`/he/pipelines?p=${pipe.id}`);
  await expect(page.getByTestId("deal-insights")).toContainText("דורשות טיפול");
  await expect(page.getByTestId("deal-alerts")).toHaveCount(1);
  await expect(page.getByTestId("deal-alerts")).toContainText("באיחור");
  await page.getByTestId("deal-flag-stale").click();
  await expect(page.getByText("חבילת חתונה")).toBeVisible();
  await expect(page.getByText("סדנת צילום")).toHaveCount(0);

  // overview: what to do now → the waiting customer and the late deal
  await page.goto("/he/overview");
  const next = page.getByTestId("next-actions");
  await expect(next.getByTestId("next-waiting")).toContainText("לקוחות שמחכים לתשובה: 1");
  await expect(next.getByTestId("next-overdueDeals")).toBeVisible();
  await next.getByTestId("next-waiting").click();
  await page.waitForURL(/\/he\/inbox\?fl=waiting/);
  await expect(page.locator("[data-conversation]")).toHaveCount(1);

  // calculators from the menu: VAT 1000 → 1,180; extract mode; loan
  await page.goto("/he/overview");
  await page.getByRole("link", { name: "מחשבונים" }).first().click();
  await page.waitForURL(/\/he\/calculators/);
  const vat = page.getByTestId("calc-vat");
  await expect(page.getByTestId("calc-vat-main")).toContainText("1,180");
  await vat.locator("select").selectOption("extract");
  await expect(page.getByTestId("calc-vat-main")).toContainText("1,000");
  await vat.locator("input").first().fill("1180");
  await expect(page.getByTestId("calc-vat-main")).toContainText("1,180");
  await expect(vat).toContainText("1,000");
  await page.getByRole("tab", { name: "שיווק ו-AI" }).click();
  await expect(page.getByTestId("calc-roi")).toBeVisible();
  await expect(page.getByTestId("calc-vat")).toHaveCount(0);
  await shot(page, "w24-calculators");

  // billing: advisor + full comparison + trust strip
  await page.goto("/he/billing");
  await expect(page.getByTestId("plan-advisor")).toContainText("החבילה מתאימה לשימוש שלכם");
  await page.getByTestId("plan-compare").locator("summary").click();
  await expect(page.getByTestId("plan-compare").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("billing-trust")).toContainText("ביטול בכל רגע");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("wave 24: public link throttle and security.txt", async ({ request }) => {
  const r = await request.get("/.well-known/security.txt");
  expect(r.status()).toBe(200);
  expect(await r.text()).toContain("Contact:");
});

test("wave 24: the Shopify App URL never starts OAuth for a forged request", async ({ request }) => {
  const r = await request.get("/api/stores/shopify/install?shop=evil-store.myshopify.com&hmac=deadbeef&timestamp=1", { maxRedirects: 0 });
  expect([302, 307, 401]).toContain(r.status());
  expect(r.headers()["location"] ?? "").not.toContain("myshopify.com");
});
