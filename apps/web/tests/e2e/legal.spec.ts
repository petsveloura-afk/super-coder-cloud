import { expect, test } from "@playwright/test";

/** The privacy policy, terms and data-deletion pages are public (no login) — Meta's app review opens them. */
test("legal pages are public in Hebrew and English", async ({ page }) => {
  for (const [path, title] of [
    ["/he/legal/privacy", "מדיניות פרטיות"],
    ["/he/legal/terms", "תנאי שימוש"],
    ["/he/legal/data-deletion", "מחיקת נתונים"],
    ["/en/legal/privacy", "Privacy"],
  ] as const) {
    const r = await page.goto(path);
    expect(r?.status()).toBe(200);
    expect(page.url()).not.toContain("/login");
    await expect(page.locator("h1")).toContainText(title);
  }
  expect((await page.goto("/he/legal/nope"))?.status()).toBe(404);
});
