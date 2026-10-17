import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const SHOTS = process.env.E2E_SCREENSHOTS_DIR;

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e5)}@e2e.test`;
}

/**
 * Password for throwaway E2E users. Generated per test run (never committed),
 * or supplied via E2E_PASSWORD. Always ≥10 chars with letters and digits.
 */
export const PASSWORD = process.env.E2E_PASSWORD ?? `E2e${randomBytes(12).toString("hex")}7x`;

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
  // Diagnostic screenshots only (sandbox/local). A slow software-rendered browser must
  // never fail a functional test, so the capture is time-boxed and best-effort.
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, timeout: 15_000 }).catch(() => {});
}

/**
 * Pages under a streaming (loading.tsx) boundary render not-found with HTTP 200
 * once streaming has started, so assert on the rendered not-found UI instead.
 */
export async function expectNotFound(page: Page) {
  await expect(page.getByText("404", { exact: true })).toBeVisible();
}

/** Integrations: the developer / manual-connection tools live in a collapsed "Advanced" section. */
export async function openAdvanced(page: Page) {
  const box = page.getByTestId("advanced-integrations");
  if (!(await box.evaluate((el) => (el as HTMLDetailsElement).open))) await box.locator("summary").click();
}

/** wave 13 — puts the signed-in org on a paid plan through the (mocked) crypto checkout + signed IPN. */
export async function upgradeByCrypto(page: Page, plan: "pro" | "business" = "business") {
  const { createHmac } = await import("node:crypto");
  const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  await page.goto("/he/billing");
  await page.getByTestId(`pay-${plan}`).locator('[data-method="crypto"]').click();
  await page.waitForURL(/checkout=pending/, { timeout: 30_000 });
  const calls = (await (await page.request.get(`${MOCK}/_calls`)).json()) as { provider: string; order_id?: string; price_amount?: number }[];
  const inv = calls.filter((c) => c.provider === "nowpayments").pop()!;
  const ipn = { payment_id: Date.now(), payment_status: "finished", order_id: inv.order_id, price_amount: inv.price_amount, price_currency: "usd", pay_amount: inv.price_amount, pay_currency: "usdttrc20", actually_paid: inv.price_amount };
  const sig = createHmac("sha512", process.env.NOWPAYMENTS_IPN_SECRET ?? "np-ipn-secret-123").update(JSON.stringify(sortKeys(ipn))).digest("hex");
  const r = await page.request.post("/api/webhooks/nowpayments", { headers: { "x-nowpayments-sig": sig, "content-type": "application/json" }, data: JSON.stringify(ipn) });
  if (!r.ok()) throw new Error(`upgrade failed: ${r.status()}`);
}
