import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signIn, signUp, uniqueEmail, upgradeByCrypto } from "./helpers";

/**
 * Wave 13 — professional websites: design templates (premium on paid plans), business
 * details + legal pages, cookie notice and accessibility menu on the public site, AI
 * editing with the agent, and domains: connect your own (DNS + verification) or buy
 * one (card payment with the platform's commission → registered → the site answers
 * on the domain). Also: the audit log is a paid feature.
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

type Call = { provider: string; kind?: string; domain?: string; expectedPrice?: number; autoRenew?: boolean; phone?: string; country?: string; templates?: string; instruction?: string; redirect?: string | null };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];

const stamp = Date.now();
const email = uniqueEmail("sitespro");
let siteUrl = "";

test("free plan: AI site with a free template, premium templates locked, business details + legal pages, public site with cookie notice and accessibility menu", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(240_000);
  await signUp(page, { name: "Site Owner", email });
  await createOrg(page, "פט-ליין", `sitespro-${stamp}`);

  // the audit log is part of Pro
  await page.goto("/he/settings");
  await expect(page.getByTestId("upgrade-audit_log")).toBeVisible();

  await page.goto("/he/websites/new");
  const card = page.getByTestId("ai-site-card");
  await expect(card.getByTestId("ai-template").locator('option[value="luxe"]')).toBeDisabled();
  await card.getByTestId("ai-template").selectOption("fresh");
  await card.locator("#ai-brief").fill("פט-ליין — מספרה וחנות לחיות מחמד בתל אביב, משלוחים עד הבית, טלפון 03-1234567");
  await card.getByRole("button", { name: "בנה לי אתר" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}\/preview$/, { timeout: 30_000 });
  const build = (await calls(request)).filter((c) => c.kind === "site-json").pop()!;
  expect(build.templates).toBe('["classic","minimal","fresh"]'); // free plan: free templates only
  await expect(page.getByTestId("pro-site")).toHaveAttribute("data-tpl", "fresh");
  await expect(page.getByRole("heading", { name: "הכלב שלך יקבל יחס של מלכים" })).toBeVisible();

  // editor: design tab — a premium template is visible but cannot be saved on the free plan
  await page.getByRole("link", { name: "עריכה ופרסום" }).first().click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("ai-edit-locked")).toBeVisible();
  await page.getByTestId("site-tabs").locator('[data-tab="design"]').click();
  await page.locator('[data-template="luxe"]').click();
  await expect(page.getByTestId("template-locked")).toBeVisible();
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await expect(page.getByText("עיצובי פרימיום זמינים במסלול Pro").first()).toBeVisible();
  await page.locator('[data-template="minimal"]').click();
  await expect(page.getByTestId("template-locked")).toHaveCount(0);

  // business details + legal pages
  await page.getByTestId("site-tabs").locator('[data-tab="business"]').click();
  await page.locator("#bz-legal_name").fill("פט-ליין בע״מ");
  await page.locator("#bz-business_id").fill("515555555");
  await page.locator("#bz-email").fill("hi@petline.co.il");
  await page.locator("#bz-whatsapp_button").fill("050-1234567");
  await page.locator('[data-legal="terms"]').getByRole("button", { name: "עריכה" }).click();
  await page.locator('[data-legal="terms"]').getByRole("button", { name: "מילוי מהתבנית" }).click();
  await expect(page.locator('[data-legal="terms"] textarea')).toHaveValue(/פט-ליין בע״מ \(ח\.פ\.\/ע\.מ\. 515555555\)/);
  await shot(page, "w13-business");

  // domain tab: the free public link, custom domains are part of Pro
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  await expect(page.getByTestId("public-link")).toBeVisible();
  await expect(page.getByTestId("upgrade-site_custom_domain")).toBeVisible();

  await page.getByRole("button", { name: "פרסום" }).click();
  await expect(page.getByText("האתר פורסם ועודכן").first()).toBeVisible();
  siteUrl = (await page.getByTestId("public-link").locator("span.font-mono").textContent())!.trim();
  expect(siteUrl).toMatch(/\/he\/s\/[a-z0-9-]+$/);

  // the public site
  await page.goto(siteUrl);
  const site = page.getByTestId("pro-site");
  await expect(site).toHaveAttribute("data-tpl", "minimal");
  await expect(site.getByText("נבנה עם Super Coder")).toBeVisible(); // free plan badge
  await expect(page.getByTestId("float-wa")).toHaveAttribute("href", "https://wa.me/972501234567");
  await expect(page.getByTestId("cookie-banner")).toBeVisible({ timeout: 30_000 }); // shown after hydration; slow external fonts can delay it
  await page.getByTestId("cookie-banner").getByRole("button", { name: "הבנתי" }).click();
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
  await page.getByTestId("a11y-button").click();
  await page.getByTestId("a11y-panel").getByRole("button", { name: "ניגודיות גבוהה" }).click();
  await expect(site).toHaveClass(/a11y-contrast/);
  await shot(page, "w13-public-site");
  // legal pages from the footer
  await site.locator("footer").getByRole("link", { name: "תנאי שימוש" }).click();
  await expect(page.getByTestId("legal-terms")).toContainText("515555555");
  await page.goto(`${siteUrl}/accessibility`);
  await expect(page.getByTestId("legal-accessibility")).toContainText("ת״י 5568");
  await page.reload();
  await expect(page.getByTestId("pro-site")).toHaveClass(/a11y-contrast/); // remembered for the visitor
  await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
});

test("paid plan: premium template, AI editing with the agent, connect an own domain, buy a domain with commission, the site answers on it", async ({ page, request }) => {
  test.skip(!mocked || !siteUrl, "needs the provider mock and the first test");
  test.setTimeout(300_000);
  await signIn(page, email);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await upgradeByCrypto(page, "business");
  await page.goto("/he/settings");
  await expect(page.getByTestId("upgrade-audit_log")).toHaveCount(0);

  await page.goto("/he/websites");
  await page.locator("[data-site]").first().getByRole("link").first().click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}$/);
  const editUrl = page.url();

  // AI editing
  await page.getByTestId("ai-edit-input").fill("תוסיף מחירון ותעבור לעיצוב יוקרתי");
  await page.getByTestId("ai-edit-run").click();
  await expect(page.getByText("השינויים הוחלו בעורך").first()).toBeVisible({ timeout: 30_000 });
  const edit = (await calls(request)).filter((c) => c.kind === "site-edit").pop()!;
  expect(edit.instruction).toContain("מחירון");
  expect(edit.templates).toContain("luxe"); // Business: every template allowed
  await expect(page.locator('[data-block="pricing"]')).toHaveCount(1);
  await page.getByTestId("site-tabs").locator('[data-tab="design"]').click();
  await expect(page.locator('[data-template="luxe"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "עדכון האתר" }).click();
  await expect(page.getByText("האתר פורסם ועודכן").first()).toBeVisible();

  // connect a domain the business already owns
  const own = `salon-${stamp}.co.il`;
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  await page.locator('[data-domain-tab="connect"]').click();
  await page.getByTestId("domain-own").fill(`https://www.${own}/`);
  await page.getByTestId("domain-connect").click();
  await expect(page.getByTestId("domain-current")).toContainText(own, { timeout: 20_000 });
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  const current = page.getByTestId("domain-current");
  await expect(current).toContainText("ממתין לחיבור");
  await expect(current).toContainText("76.76.21.21");
  await expect(current).toContainText("vc-domain-verify");
  expect((await calls(request)).some((c) => c.provider === "vercel" && c.kind === "add" && c.domain === `www.${own}` && c.redirect === own)).toBe(true);
  // the customer updates DNS → check → active
  await request.post(`${MOCK}/_vercel/dns?domain=${own}`);
  await current.getByTestId("domain-check").click();
  await expect(page.getByText("הדומיין פעיל והאתר עולה עליו").first()).toBeVisible();
  // remove it again
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  await page.getByTestId("domain-current").getByRole("button", { name: "ניתוק הדומיין" }).click();
  await expect(page.getByText("הדומיין נותק").first()).toBeVisible();

  // buy a new domain
  const name = `pet-line-${stamp}`;
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  await page.locator('[data-domain-tab="buy"]').click();
  await page.getByTestId("domain-search").fill(name);
  await page.getByTestId("domain-search-run").click();
  const row = page.getByTestId("domain-results").locator(`[data-domain="${name}.com"]`);
  await expect(row).toContainText("$16.25"); // cost 11.25 + min fee 5
  await expect(page.getByTestId("domain-results").locator(`[data-domain="${name}.co.il"]`)).toContainText("$19.00"); // 14 + min fee 5
  await row.getByTestId("domain-pick").click();
  const form = page.getByTestId("domain-contact");
  for (const [k, v] of Object.entries({ firstName: "Dana", lastName: "Cohen", email: "dana@example.com", phone: "050-1234567", address1: "Herzl 1", city: "Tel Aviv", state: "Tel Aviv", zip: "6100001" })) await form.locator(`#dc-${k}`).fill(v);
  await form.getByTestId("domain-buy").click();
  await expect(page.getByTestId("domain-pay").getByTestId("mock-card-form")).toBeVisible({ timeout: 20_000 });
  await shot(page, "w13-domain-pay");
  await page.getByTestId("mock-card-pay").click();
  await expect(page.getByText("הדומיין נקנה וחובר לאתר").first()).toBeVisible({ timeout: 30_000 });
  const buy = (await calls(request)).filter((c) => c.provider === "vercel" && c.kind === "buy").pop()!;
  expect(buy).toMatchObject({ domain: `${name}.com`, expectedPrice: 11.25, autoRenew: false, phone: "+972.501234567", country: "IL" });
  await page.goto(editUrl);
  await page.getByTestId("site-tabs").locator('[data-tab="domain"]').click();
  await expect(page.getByTestId("domain-current")).toContainText(`${name}.com`);
  await expect(page.getByTestId("domain-current")).toContainText("פעיל");
  await expect(page.getByTestId("domain-orders")).toContainText("$16.25");

  // the site answers on its own domain (home + legal pages), without the free badge (white label on Business)
  const home = await request.get("/", { headers: { "x-forwarded-host": `${name}.com` }, maxRedirects: 0 });
  expect(home.status()).toBe(200);
  const html = await home.text();
  expect(html).toContain('data-tpl="luxe"');
  expect(html).toContain("המחירון שלנו");
  expect(html).not.toContain('class="made"'); // no "built with" badge
  expect(html).toContain('href="/privacy"');
  const legal = await request.get("/privacy", { headers: { "x-forwarded-host": `www.${name}.com` }, maxRedirects: 0 });
  expect(await legal.text()).toContain("מדיניות פרטיות");

  // a registration that fails after payment is refunded automatically
  await page.locator('[data-domain-tab="buy"]').click();
  await page.getByTestId("domain-search").fill(`failreg-${stamp}`);
  await page.getByTestId("domain-search-run").click();
  const bad = page.getByTestId("domain-results").locator(`[data-domain="failreg-${stamp}.com"]`);
  await bad.getByTestId("domain-pick").click();
  for (const [k, v] of Object.entries({ firstName: "Dana", lastName: "Cohen", email: "dana@example.com", phone: "+972501234567", address1: "Herzl 1", city: "Tel Aviv", state: "Tel Aviv", zip: "6100001" })) await page.getByTestId("domain-contact").locator(`#dc-${k}`).fill(v);
  await page.getByTestId("domain-buy").click();
  await page.getByTestId("mock-card-pay").click();
  await expect(page.getByText("רישום הדומיין נכשל, והתשלום הוחזר לכרטיס").first()).toBeVisible({ timeout: 30_000 });
  expect((await calls(request)).some((c) => c.provider === "paypal" && c.kind === "refund")).toBe(true);
});
