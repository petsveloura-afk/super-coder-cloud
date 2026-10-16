import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/** AI studio v2: saved conversations, Markdown answers, landing page built from the chat, AI site builder. */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
test.describe.configure({ mode: "serial" });

test("agent chat is saved, renders Markdown and builds a landing page draft from the conversation", async ({ page }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await signUp(page, { name: "Studio Owner", email: uniqueEmail("studio") });
  await createOrg(page, "Studio Co", `studio-${Date.now()}`);
  await page.goto("/he/ai-agents");
  await page.getByRole("button", { name: "סוכן חדש" }).first().click();
  const d = page.getByRole("dialog");
  await d.locator("#agent-name").fill("נציג אתרים");
  await expect(d.getByLabel("בניית דפי נחיתה ואתרים מתוך השיחה")).toBeChecked();
  await d.locator('button[type="submit"]').click();
  await expect(page.getByText("נציג אתרים").first()).toBeVisible();

  const box = page.getByPlaceholder("כתבו הודעה לסוכן…");
  await box.fill("שלום, מה שעות הפעילות?");
  await box.press("Enter");
  await expect(page.getByTestId("chat-log").locator('[data-role="user"]').first()).toContainText("שלום, מה שעות הפעילות?"); // optimistic
  await expect(page.getByText(/MOCK-(AI|GEMINI) ✓/).first()).toBeVisible();

  await box.fill("בנה לי דף נחיתה לעסק שלי פט-ליין, מספרה לכלבים בתל אביב");
  await page.getByRole("button", { name: "שליחה" }).click();
  const card = page.getByTestId("site-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("פט-ליין");
  await expect(card).toContainText("דף נחיתה");
  // the control line never reaches the user, Markdown bold is rendered
  await expect(page.getByTestId("chat-log")).not.toContainText("BUILD_SITE");
  await expect(page.getByTestId("chat-log").locator("strong", { hasText: "מעולה!" })).toBeVisible();
  await shot(page, "s1-studio-chat");

  // the conversation survives a reload
  await page.reload();
  await page.locator("[data-conversation-item]").first().click();
  await expect(page.getByTestId("chat-log")).toContainText("שלום, מה שעות הפעילות?");
  await expect(page.getByTestId("site-card")).toBeVisible();

  // preview the generated draft — sanitized and complete
  await page.getByTestId("site-card").getByRole("link", { name: "תצוגה מקדימה" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}\/preview$/);
  const preview = page.getByTestId("site-preview");
  await expect(preview.getByRole("heading", { name: "הכלב שלך יקבל יחס של מלכים" })).toBeVisible();
  await expect(preview.getByText("כמה זמן לוקח טיפוח?")).toBeVisible();
  expect(await preview.locator('a[href^="javascript:"]').count()).toBe(0);
  await expect(page.getByText("טיוטה").first()).toBeVisible();
  await shot(page, "s2-site-preview");

  await page.goto("/he/websites");
  await expect(page.getByText("פט-ליין").first()).toBeVisible();
});

test("websites: build a site with AI from a brief (free plan → landing page, full site locked)", async ({ page }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(120_000);
  await signUp(page, { name: "Brief Owner", email: uniqueEmail("brief") });
  await createOrg(page, "Brief Co", `brief-${Date.now()}`);
  await page.goto("/he/websites/new");
  const card = page.getByTestId("ai-site-card");
  await expect(card.getByRole("checkbox")).toBeDisabled(); // full sites are a paid feature
  await card.locator("#ai-brief").fill("פט-ליין — מספרה וחנות לחיות מחמד בתל אביב, משלוחים עד הבית");
  await card.getByRole("button", { name: "בנה לי אתר" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}\/preview$/, { timeout: 30_000 });
  await expect(page.getByTestId("site-preview").getByRole("heading", { name: "הכלב שלך יקבל יחס של מלכים" })).toBeVisible();
  await page.getByRole("link", { name: "עריכה ופרסום" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "פרסום" }).click();
  await expect(page.getByText(/האתר פורסם/)).toBeVisible();
});

test("paid plan: the agent builds a full website (AI hero image attempted, never blocking)", async ({ page, request }) => {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  test.skip(!mocked || !service || !supabaseUrl, "needs the provider mock and the service role");
  test.setTimeout(150_000);
  const slug = `paid-${Date.now()}`;
  await signUp(page, { name: "Paid Owner", email: uniqueEmail("paid") });
  await createOrg(page, "Paid Co", slug);
  const headers = { apikey: service!, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const up = await request.patch(`${supabaseUrl}/rest/v1/organizations?slug=eq.${slug}`, { headers, data: { plan: "business" } });
  expect(up.ok()).toBe(true);
  await page.goto("/he/ai-agents");
  await page.getByRole("button", { name: "סוכן חדש" }).first().click();
  await page.getByRole("dialog").locator("#agent-name").fill("בונה אתרים");
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.getByText("בונה אתרים").first()).toBeVisible();
  await expect(page.getByText("בונה אתרים מלאים")).toBeVisible();
  const box = page.getByPlaceholder("כתבו הודעה לסוכן…");
  await box.fill("בנה לי אתר מלא לעסק פט-ליין, מספרה לכלבים בתל אביב");
  await box.press("Enter");
  const card = page.getByTestId("site-card");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("אתר מלא");
  await expect(card).not.toContainText("במסלול בתשלום");
});
