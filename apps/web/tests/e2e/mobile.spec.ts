import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

test("mobile (iPhone viewport): bottom navigation, cards and bottom-sheet dialog", async ({ page }) => {
  await signUp(page, { name: "מובייל", email: uniqueEmail("mobile") });
  await createOrg(page, "נייד בע״מ", `mobile-${Date.now()}`);
  await page.getByRole("button", { name: "טעינת נתוני דמו" }).click();
  await expect(page.getByText(/סביבת דמו — הנתונים בדויים/)).toBeVisible();

  const bottomNav = page.locator("nav.fixed");
  await expect(bottomNav).toBeVisible();
  await expect(page.locator("aside")).toBeHidden();
  await shot(page, "m1-overview-mobile");

  await bottomNav.getByRole("link", { name: "אנשי קשר" }).click();
  await page.waitForURL(/\/he\/crm/);
  await expect(page.locator("table")).toBeHidden(); // cards, not a squeezed table
  await shot(page, "m2-crm-mobile");

  await bottomNav.getByRole("button", { name: "עוד" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "m3-menu-sheet");
});

test("mobile (iPhone viewport): wave 8 screens fit the phone — billing & payment methods, integrations, agent setup, website chat", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const slug = `mob8-${Date.now()}`;
  await signUp(page, { name: "מובייל 8", email: uniqueEmail("mob8") });
  await createOrg(page, "נייד שמונה", slug);
  const noSideScroll = async (name: string) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${name} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
    await shot(page, name);
  };

  await page.goto("/he/billing");
  await expect(page.locator("main")).toBeVisible();
  await noSideScroll("m4-billing-mobile");

  await page.goto("/he/integrations");
  await expect(page.locator('[data-hub="web"]')).toBeVisible();
  await noSideScroll("m5-integrations-mobile");

  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();
  await noSideScroll("m6-agents-mobile");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("agent-setup-link").first().click();
  await expect(page).toHaveURL(/\/setup$/, { timeout: 20_000 });
  await expect(page.getByTestId("agent-setup")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("flow-template").click();
  const menu = page.getByTestId("menu-editor");
  await menu.getByRole("textbox").last().fill("💰 מחירים");
  await menu.getByRole("textbox").last().press("Enter");
  await expect(page.getByTestId("setup-save")).toBeInViewport();
  await noSideScroll("m7-agent-setup-mobile");
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("הסוכן נשמר").first()).toBeVisible();

  const ctx = await browser.newContext({ ...(test.info().project.use as object) });
  const v = await ctx.newPage();
  await v.goto(`/he/chat/${slug}`);
  await expect(v.getByTestId("chat-panel")).toBeVisible();
  await expect(v.getByTestId("chat-menu")).toContainText("💰 מחירים");
  const over = await v.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  await shot(v, "m8-chat-mobile");
  await ctx.close();
});

test("mobile (iPhone viewport): wave 13 — website editor tabs and a published site fit the phone", async ({ page }) => {
  test.skip(process.env.E2E_PROVIDERS_MOCKED !== "true", "needs the provider mock");
  test.setTimeout(150_000);
  const noSideScroll = async (name: string) => {
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${name} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
    await shot(page, name);
  };
  await signUp(page, { name: "אתר נייד", email: uniqueEmail("msite") });
  await createOrg(page, "אתר נייד", `msite-${Date.now()}`);
  await page.goto("/he/websites/new");
  await page.getByTestId("ai-site-card").locator("#ai-brief").fill("סטודיו ליוגה בחיפה, שיעורי בוקר וערב, אווירה רגועה");
  await page.getByTestId("ai-site-card").getByRole("button", { name: "בנה לי אתר" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}\/preview$/, { timeout: 30_000 });
  await noSideScroll("m8-site-preview-mobile");
  await page.getByRole("link", { name: "עריכה ופרסום" }).first().click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}$/);
  for (const tab of ["content", "design", "business", "domain"]) {
    await page.getByTestId("site-tabs").locator(`[data-tab="${tab}"]`).click();
    await noSideScroll(`m9-site-${tab}-mobile`);
  }
  await page.getByRole("button", { name: "פרסום" }).click();
  await expect(page.getByText("האתר פורסם ועודכן").first()).toBeVisible();
  const url = (await page.getByTestId("public-link").locator("span.font-mono").textContent())!.trim();
  await page.goto(url);
  await expect(page.getByTestId("pro-site")).toBeVisible();
  await noSideScroll("m10-public-site-mobile");
  await page.goto(`${url}/privacy`);
  await noSideScroll("m11-legal-mobile");
});

test("mobile (iPhone viewport): wave 14 — plan cards show real feature names, card checkout opens on its own page and pays", async ({ page }) => {
  test.skip(process.env.E2E_PROVIDERS_MOCKED !== "true", "needs the provider mock");
  test.setTimeout(150_000);
  await signUp(page, { name: "קונה נייד", email: uniqueEmail("mpay") });
  await createOrg(page, "קונה נייד", `mpay-${Date.now()}`);
  await page.goto("/he/billing");
  const main = page.locator("main");
  await expect(main).not.toContainText("billing.features."); // every feature has a name
  const pro = page.getByTestId("pay-pro").locator("xpath=ancestor::*[contains(@class,'flex-col')][1]");
  await expect(main.getByText("אתרים מלאים ב-AI").first()).toBeVisible();
  await expect(main.getByText(/אתרים מלאים ב-AI\s*\(בקרוב\)/)).toHaveCount(0); // works today — not "coming soon"
  void pro;
  await page.getByTestId("pay-pro").locator('[data-method="card_inline"]').click();
  await page.waitForURL(/\/he\/billing\/checkout\?plan=pro/);
  await expect(page.getByTestId("checkout-summary")).toContainText("149");
  await expect(page.getByTestId("card-checkout").getByTestId("mock-card-form")).toBeVisible({ timeout: 20_000 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(1);
  await shot(page, "m12-checkout-mobile");
  await page.getByTestId("mock-card-pay").click();
  await expect(page).toHaveURL(/\/he\/billing\?checkout=success/, { timeout: 30_000 });
});

test("mobile (iPhone viewport): wave 20 — inbox in the tab bar, modules grid, no sideways page, WhatsApp code by default", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "נייד 20", email: uniqueEmail("mob20") });
  await createOrg(page, "נייד עשרים", `mob20-${Date.now()}`);
  await page.getByRole("button", { name: "טעינת נתוני דמו" }).click();
  await expect(page.getByText(/סביבת דמו — הנתונים בדויים/)).toBeVisible();
  const tabs = page.locator("nav.fixed");
  // what an owner opens most on the phone: overview, inbox, contacts, AI agents + More
  for (const name of ["סקירה כללית", "תיבת הודעות", "אנשי קשר", "סוכני AI"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
  await expect(page.getByTestId("mobile-org")).toHaveText("נייד עשרים");
  await expect(page.getByTestId("ai-pulse")).toBeVisible();
  await tabs.getByRole("button", { name: "עוד" }).click();
  const grid = page.getByRole("dialog").getByTestId("nav-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("link", { name: "צוות", exact: true })).toBeVisible();
  await shot(page, "m20-more-grid");
  await grid.getByRole("link", { name: "צינורות מכירה" }).click();
  await page.waitForURL(/\/he\/pipelines/);
  await page.waitForLoadState("networkidle");
  // the board scrolls inside its own box; the page itself never scrolls sideways
  for (const path of ["/he/pipelines", "/he/analytics", "/he/integrations", "/he/crm", "/he/finance"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${path} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
  }
  await shot(page, "m20-finance");
  // a phone can't scan its own screen → the WhatsApp dialog opens on the code tab
  if (process.env.E2E_PROVIDERS_MOCKED === "true") {
    await page.goto("/he/integrations");
    await page.getByTestId("wa-connect").click();
    await expect(page.getByTestId("wa-tab-code")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("wa-pair-phone")).toBeVisible();
    await shot(page, "m20-wa-code");
  }
});
