import { expect, test } from "@playwright/test";
import { createOrg, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 23 — the user guide inside the app:
 *  - "User guide" in the menu opens 29 steps with marked screenshots, chapters and search
 *  - the help button on every screen opens the step for that screen (inbox → the inbox step)
 */
test("wave 23: the in-app guide and the help button for the current screen", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Guide User", email: uniqueEmail("w23") });
  await createOrg(page, "סטודיו מדריך", `w23-${Date.now()}`);

  // the menu has the guide
  const nav = page.getByRole("link", { name: "מדריך שימוש" }).first();
  await expect(nav).toBeVisible();
  await nav.click();
  await page.waitForURL(/\/he\/guide/);
  const guide = page.getByTestId("guide");
  await expect(guide.locator(".g-slide")).toHaveCount(29, { timeout: 30_000 });
  await expect(guide.locator(".g-slide.active h3")).toHaveText("יוצרים חשבון");
  await expect(guide.locator(".g-slide.active .mk")).toHaveCount(4);
  await expect(guide.locator(".g-slide.active img")).toHaveJSProperty("complete", true);
  // next step
  await guide.locator(".g-next").click();
  await expect(guide.locator(".g-slide.active h3")).toHaveText("פותחים סביבת עבודה לעסק");
  // search → jump
  await guide.locator('input[type="search"]').fill("טלגרם");
  await expect(guide.locator(".g-results button").first()).toBeVisible();
  await guide.locator('input[type="search"]').press("Enter");
  await expect(guide.locator(".g-slide.active h3")).toHaveText("מחברים טלגרם");
  // the guide page itself has no help button
  await expect(page.getByTestId("guide-help")).toHaveCount(0);

  // help on the inbox → the inbox step, with a link back to the inbox
  await page.goto("/he/inbox");
  const help = page.getByTestId("guide-help");
  await expect(help).toHaveAttribute("data-step", "s09-inbox");
  await help.click();
  await page.waitForURL(/\/he\/guide#s09-inbox/);
  await expect(page.getByTestId("guide").locator(".g-slide.active h3")).toHaveText("תיבת הודעות אחת לכל הערוצים", { timeout: 30_000 });
  await expect(page.getByTestId("guide").locator(".g-slide.active .g-open")).toHaveAttribute("href", "/he/inbox");

  // CRM → contacts step
  await page.goto("/he/crm");
  await expect(page.getByTestId("guide-help")).toHaveAttribute("data-step", "s11-crm");
});

test("wave 23: on the phone the help button sits above the tab bar", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signUp(page, { name: "Guide Phone", email: uniqueEmail("w23m") });
  await createOrg(page, "סטודיו נייד", `w23m-${Date.now()}`);
  const help = page.getByTestId("guide-help");
  await expect(help).toBeVisible();
  const hb = (await help.boundingBox())!;
  const tabs = (await page.locator("nav.fixed").last().boundingBox())!;
  expect(hb.y + hb.height).toBeLessThanOrEqual(tabs.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
