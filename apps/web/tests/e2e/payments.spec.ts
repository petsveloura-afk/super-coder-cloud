import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/** Wave 8 — paying for a plan with PayPal (PayPal or card), crypto (NOWPayments) and card (Lemon Squeezy); receipts. */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

type Call = { provider: string; kind?: string; custom_id?: string; order_id?: string; custom?: { org_id?: string } };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

test("PayPal: pay for Pro with PayPal / card → plan active, receipt, then cancel", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await signUp(page, { name: "Pay Owner", email: uniqueEmail("paypal") });
  await createOrg(page, "Pay Co", `paypal-${Date.now()}`);
  await page.goto("/he/billing");
  const pro = page.getByTestId("pay-pro");
  await expect(pro.locator('[data-method="paypal"]')).toContainText("PayPal או כרטיס אשראי");
  await expect(pro.locator('[data-method="crypto"]')).toBeVisible();
  await shot(page, "b1-billing-methods");
  await pro.locator('[data-method="paypal"]').click();
  await expect(page).toHaveURL(/\/he\/billing\?checkout=success/, { timeout: 30_000 });
  await expect(page.locator("main").getByText("Pro", { exact: true }).first()).toBeVisible();
  const history = page.getByTestId("payment-history");
  await expect(history).toContainText("PayPal / כרטיס");
  await expect(history).toContainText("149");
  await history.getByRole("link", { name: "קבלה" }).first().click();
  await expect(page).toHaveURL(/\/he\/receipt\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("עוסק 123456789");
  await expect(receipt).toContainText("149");
  await expect(receipt).toContainText("התשלום התקבל במלואו");
  await shot(page, "b2-receipt");

  // forged webhook is rejected
  const bad = await request.post("/api/webhooks/paypal", { headers: { "paypal-transmission-sig": "forged" }, data: { id: "WH-EV-1", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-NOPE" } } });
  expect(bad.status()).toBe(400);
  // a verified webhook is processed once
  const sub = (await calls(request)).filter((c) => c.provider === "paypal" && c.kind === "subscription").pop()!;
  const ev = { id: `WH-EV-${Date.now()}`, event_type: "BILLING.SUBSCRIPTION.UPDATED", resource: { id: (sub as unknown as { id: string }).id } };
  expect((await request.post("/api/webhooks/paypal", { headers: { "paypal-transmission-sig": "good-sig" }, data: ev })).ok()).toBe(true);
  expect(((await (await request.post("/api/webhooks/paypal", { headers: { "paypal-transmission-sig": "good-sig" }, data: ev })).json()) as { duplicate?: boolean }).duplicate).toBe(true);

  await page.goto("/he/billing");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "ביטול המנוי ב-PayPal" }).click();
  await expect(page).toHaveURL(/checkout=canceled/, { timeout: 30_000 });
  await expect(page.getByText("חינם").first()).toBeVisible();
});

test("crypto: pay for Business → signed IPN activates a prepaid period with a receipt (idempotent)", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await signUp(page, { name: "Crypto Owner", email: uniqueEmail("crypto") });
  await createOrg(page, "Crypto Co", `crypto-${Date.now()}`);
  await page.goto("/he/billing");
  await page.getByTestId("pay-business").locator('[data-method="crypto"]').click();
  await expect(page).toHaveURL(/checkout=pending/, { timeout: 30_000 });
  await expect(page.getByText(/התשלום בתהליך אישור/)).toBeVisible();
  const inv = (await calls(request)).filter((c) => c.provider === "nowpayments").pop()!;
  expect((inv as unknown as { price_currency: string }).price_currency).toBe("usd");
  const ipn = { payment_id: Date.now(), payment_status: "finished", order_id: inv.order_id, price_amount: 108, price_currency: "usd", pay_amount: 108.2, pay_currency: "usdttrc20", actually_paid: 108.2 };
  const raw = JSON.stringify(ipn);
  const sig = createHmac("sha512", "np-ipn-secret-123").update(JSON.stringify(sortKeys(ipn))).digest("hex");
  expect((await request.post("/api/webhooks/nowpayments", { headers: { "x-nowpayments-sig": "00" + sig.slice(2), "content-type": "application/json" }, data: raw })).status()).toBe(400);
  expect((await request.post("/api/webhooks/nowpayments", { headers: { "x-nowpayments-sig": sig, "content-type": "application/json" }, data: raw })).ok()).toBe(true);
  const again = await request.post("/api/webhooks/nowpayments", { headers: { "x-nowpayments-sig": sig, "content-type": "application/json" }, data: raw });
  expect(((await again.json()) as { duplicate?: boolean }).duplicate).toBe(true);
  await page.goto("/he/billing");
  await expect(page.locator("main").getByText("Business", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("payment-history")).toContainText("מטבע דיגיטלי");
  await expect(page.getByTestId("payment-history").locator("li")).toHaveCount(1);
});

test("card via Lemon Squeezy: checkout → signed webhooks → plan + payment", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await signUp(page, { name: "Card Owner", email: uniqueEmail("lemon") });
  await createOrg(page, "Card Co", `lemon-${Date.now()}`);
  await page.goto("/he/billing");
  await page.getByTestId("pay-pro").locator('[data-method="lemonsqueezy"]').click();
  await expect(page).toHaveURL(/checkout=success/, { timeout: 30_000 });
  const chk = (await calls(request)).filter((c) => c.provider === "lemonsqueezy").pop()!;
  const org = chk.custom!.org_id!;
  const post = (data: object) => {
    const raw = JSON.stringify(data);
    return request.post("/api/webhooks/lemonsqueezy", { headers: { "x-signature": createHmac("sha256", "ls-secret-123").update(raw).digest("hex"), "content-type": "application/json" }, data: raw });
  };
  const subEv = { meta: { event_name: "subscription_created", custom_data: { org_id: org, plan: "pro", interval: "month" } }, data: { id: `sub_${Date.now()}`, type: "subscriptions", attributes: { status: "active", variant_id: 111, customer_id: 9, renews_at: new Date(Date.now() + 30 * 86400000).toISOString(), created_at: new Date().toISOString() } } };
  expect((await request.post("/api/webhooks/lemonsqueezy", { headers: { "x-signature": "bad" }, data: subEv })).status()).toBe(400);
  expect((await post(subEv)).ok()).toBe(true);
  expect((await post({ meta: { event_name: "subscription_payment_success", custom_data: { org_id: org, plan: "pro", interval: "month" } }, data: { id: `inv_${Date.now()}`, type: "subscription-invoices", attributes: { total: 4000, currency: "USD", user_email: "card@example.com", status: "paid", created_at: new Date().toISOString() } } })).ok()).toBe(true);
  await page.goto("/he/billing");
  await expect(page.locator("main").getByText("Pro", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("payment-history")).toContainText("כרטיס אשראי");
  await expect(page.getByTestId("payment-history")).toContainText("40");
});
