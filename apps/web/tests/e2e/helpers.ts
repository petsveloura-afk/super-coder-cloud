import { expect, type Page } from "@playwright/test";

export const SHOTS = process.env.E2E_SCREENSHOTS_DIR;

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e5)}@e2e.test`;
}

export const PASSWORD = "E2eStrongPass2026";

export async function signUp(page: Page, opts: { name: string; email: string; locale?: string }) {
  const locale = opts.locale ?? "he";
  await page.goto(`/${locale}/signup`);
  await page.locator("#fullName").fill(opts.name);
  await page.locator("#email").fill(opts.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(new RegExp(`/${locale}/onboarding`));
}

export async function signIn(page: Page, email: string, locale = "he") {
  await page.goto(`/${locale}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
}

export async function createOrg(page: Page, name: string, slug: string) {
  await page.locator("#name").fill(name);
  await page.locator("#slug").fill(slug);
  await page.locator('form:has(#slug) button[type="submit"]').click();
  await page.waitForURL(/\/overview$/);
  await expect(page.locator("h1")).toBeVisible();
}

export async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/**
 * Pages under a streaming (loading.tsx) boundary render not-found with HTTP 200
 * once streaming has started, so assert on the rendered not-found UI instead.
 */
export async function expectNotFound(page: Page) {
  await expect(page.getByText("404", { exact: true })).toBeVisible();
}
