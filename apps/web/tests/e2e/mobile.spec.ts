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
