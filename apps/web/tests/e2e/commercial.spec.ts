import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * Commercial layer journeys. AI/Stripe calls require provider credentials; in CI
 * they run against a local mock (AI_ANTHROPIC_BASE_URL / PAYMENT_PROVIDER_API_BASE).
 * When E2E_PROVIDERS_MOCKED is not set, the provider-dependent assertions are skipped.
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";

test.describe.configure({ mode: "serial" });

test("billing page shows plans, usage meters and the free plan as current", async ({ page }) => {
  await signUp(page, { name: "Billing Owner", email: uniqueEmail("bill") });
  await createOrg(page, "Billing Co", `bill-${Date.now()}`);
  await page.goto("/he/billing");
  await expect(page.getByRole("heading", { name: "מנוי וחיוב" })).toBeVisible();
  for (const name of ["חינם", "Pro", "Business", "Enterprise"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText("החבילה שלך")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "אנשי קשר" })).toBeVisible();
  await page.goto("/he/billing?interval=year");
  await expect(page.getByRole("tab", { name: /שנתי/ })).toHaveAttribute("aria-selected", "true");
  await shot(page, "c1-billing-he");
  await page.goto("/en/billing");
  await shot(page, "c2-billing-en");
  if (mocked) {
    await page.getByRole("button", { name: "Upgrade" }).first().click();
    await page.waitForURL(/checkout=success/);
    await expect(page.getByText(/Payment received|התשלום התקבל/)).toBeVisible();
  }
});

test("AI studio: create agent, chat, contact assistant, credits metered", async ({ page }) => {
  await signUp(page, { name: "AI Owner", email: uniqueEmail("ai") });
  await createOrg(page, "AI Co", `ai-${Date.now()}`);
  await page.goto("/he/ai-agents");
  await expect(page.getByRole("heading", { name: "סוכני AI" })).toBeVisible();
  await page.getByRole("button", { name: "סוכן חדש" }).first().click();
  const d = page.getByRole("dialog");
  await d.locator("#agent-name").fill("נציג מכירות");
  await d.locator("#agent-instructions").fill("ענה בקצרה ובנימוס. אל תמציא מחירים.");
  await d.locator('button[type="submit"]').click();
  await expect(page.getByText("נציג מכירות").first()).toBeVisible();
  await shot(page, "c3-ai-studio");

  if (!mocked) return;
  await page.getByPlaceholder("כתבו הודעה לסוכן…").fill("שלום, מה שעות הפעילות?");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByText(/MOCK-AI ✓/).first()).toBeVisible();

  await page.goto("/he/crm?new=1");
  const c = page.getByRole("dialog");
  await c.locator("#firstName").fill("דנה");
  await c.locator("#email").fill(uniqueEmail("dana"));
  await c.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "סיכום AI" }).click();
  await expect(page.getByText(/MOCK-AI ✓.*data-block-ok/)).toBeVisible();
  await page.getByRole("button", { name: "שמירה כהערה" }).click();
  await expect(page.getByText(/\[AI\] MOCK-AI/)).toBeVisible();
  await shot(page, "c4-contact-ai");

  await page.goto("/he/billing");
  // 2 calls × ceil(1500 tokens / 1000) = 4 credits of 50
  await expect(page.getByText("4 / 50")).toBeVisible();
});

test("AI is blocked in demo workspaces", async ({ page }) => {
  await signUp(page, { name: "Demo AI", email: uniqueEmail("demoai") });
  await createOrg(page, "Demo AI Co", `demoai-${Date.now()}`);
  await page.getByRole("button", { name: "טעינת נתוני דמו" }).click();
  await expect(page.getByText(/סביבת דמו/).first()).toBeVisible();
  await page.goto("/he/ai-agents");
  await expect(page.getByText("בסביבת דמו לא נשלחות בקשות AI אמיתיות")).toBeVisible();
});

test("keep-alive endpoint performs a DB round-trip and exposes no data", async ({ request }) => {
  const r = await request.get("/api/keepalive", {
    headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
  });
  expect(r.status()).toBe(200);
  const j = await r.json();
  expect(j.ok).toBe(true);
  expect(Object.keys(j).sort()).toEqual(["db", "maintenance", "ms", "ok", "time"]);
  if (process.env.CRON_SECRET) expect(j.maintenance).toBe("ran");
  if (process.env.CRON_SECRET) expect((await request.get("/api/keepalive")).status()).toBe(401);
});

test("stripe webhook rejects unsigned requests", async ({ request }) => {
  const r = await request.post("/api/webhooks/stripe", { data: { id: "evt_x", type: "checkout.session.completed" } });
  expect([400, 503]).toContain(r.status());
});
