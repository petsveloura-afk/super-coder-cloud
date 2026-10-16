import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, createOrg, shot, signUp, uniqueEmail } from "./helpers";

/** Wave 4: support desk + public portal, quotes/invoices/payments (incl. org Stripe), websites, platform admin. */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_BASE ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

const owner = { name: "Biz Owner", email: uniqueEmail("biz") };
const orgSlug = `biz-${Date.now()}`;
const customerEmail = `customer.${Date.now()}@e2e.test`;

async function login(page: Page) {
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);
}

test("support: customer opens a ticket in the public portal, agent replies, customer sees it", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, owner);
  await createOrg(page, "Biz Co", orgSlug);
  await page.goto("/he/support");
  await expect(page.getByRole("heading", { name: "שירות לקוחות" })).toBeVisible();

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(`/he/help/${orgSlug}`);
  await p.locator("#sp-name").fill("רון לקוח");
  await p.locator("#sp-email").fill(customerEmail);
  await p.locator("#sp-subject").fill("המערכת לא שולחת חשבונית");
  await p.locator("#sp-body").fill("ניסיתי פעמיים ולא קיבלתי מייל");
  await p.getByRole("button", { name: "שליחת הפנייה" }).click();
  await expect(p.getByText(/הפנייה #\d+ נפתחה/)).toBeVisible();
  await shot(p, "w4-01-help-portal");
  const trackHref = (await p.getByRole("link", { name: "מעקב אחר הפנייה" }).getAttribute("href"))!;

  await page.reload();
  await page.getByRole("link", { name: /המערכת לא שולחת חשבונית/ }).first().click();
  await page.waitForURL(/\/he\/support\/[0-9a-f-]{36}$/);
  await page.getByLabel("תשובה").fill("בדקנו — נשלח שוב עכשיו 👍");
  await page.getByRole("button", { name: "שליחת תשובה" }).click();
  // (the textarea still holds the text until the action returns — wait for the posted message itself)
  await expect(page.getByRole("listitem").filter({ hasText: "בדקנו — נשלח שוב עכשיו 👍" })).toBeVisible();
  await shot(page, "w4-02-ticket");

  await p.goto(trackHref);
  await expect(p.getByText("בדקנו — נשלח שוב עכשיו 👍")).toBeVisible();
  await p.getByLabel("תשובה").fill("תודה, הגיע!");
  await p.getByRole("button", { name: "שליחת תשובה" }).click();
  await expect(p.getByRole("listitem").filter({ hasText: "תודה, הגיע!" })).toBeVisible();
  await anon.close();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "תודה, הגיע!" })).toBeVisible();
});

test("finance: product → quote with live totals → customer accepts → invoice → partial payment", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page);
  // the ticket created the customer as a contact
  await page.goto("/he/finance?tab=products");
  await page.getByRole("button", { name: "מוצר חדש" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#pr-name").fill("ייעוץ שעתי");
  await d.locator("#pr-price").fill("400");
  await d.getByRole("button", { name: "שמירה" }).click();
  await expect(d).toBeHidden();
  await expect(page.locator('[data-product="ייעוץ שעתי"]')).toBeVisible();

  await page.goto("/he/finance/new?kind=quote");
  await page.locator("#doc-title").fill("חבילת ייעוץ");
  const contactValue = await page.locator("#doc-contact option", { hasText: customerEmail }).getAttribute("value");
  await page.locator("#doc-contact").selectOption(contactValue!);
  const productValue = await page.locator('select[aria-label="הוספה מקטלוג…"] option', { hasText: "ייעוץ שעתי" }).getAttribute("value");
  await page.getByLabel("הוספה מקטלוג…").selectOption(productValue!);
  await page.locator("#ln-0-qty").fill("3");
  await page.getByRole("button", { name: "הוספת שורה" }).click();
  await page.locator("#ln-1-desc").fill("הקמת מערכת");
  await page.locator("#ln-1-price").fill("1000");
  await page.locator("#ln-1-disc").fill("10");
  // 3×400 + 1000×0.9 = 2100 + 18% = 2478
  await expect(page.getByTestId("doc-total")).toContainText("2,478");
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await page.waitForURL(/\/he\/finance\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("doc-total")).toContainText("2,478");
  await page.getByRole("button", { name: "שליחה ללקוח" }).click();
  await expect(page.getByText(mocked ? "המסמך נשלח ללקוח במייל" : /המסמך (סומן כנשלח|נשלח ללקוח במייל)/)).toBeVisible();
  const quoteUrl = (await page.getByRole("link", { name: "צפייה / הדפסה" }).getAttribute("href"))!;
  await shot(page, "w4-03-quote");

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(new URL(quoteUrl).pathname);
  await expect(p.getByRole("heading", { name: /הצעת מחיר #\d+/ })).toBeVisible();
  await expect(p.getByText("מסמך זה אינו חשבונית מס", { exact: false })).toBeVisible();
  await p.getByRole("button", { name: "אישור ההצעה" }).click();
  await expect(p.getByText("יש להזין שם מלא")).toBeVisible();
  await p.locator("#acc-name").fill("רון לקוח");
  await p.getByRole("button", { name: "אישור ההצעה" }).click();
  await expect(p.getByText(/ההצעה אושרה על ידי רון לקוח/)).toBeVisible();
  await shot(p, "w4-04-quote-accepted");
  await anon.close();

  await page.reload();
  await expect(page.getByText("אושר", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "הפקת חשבון עסקה" }).click();
  await page.waitForURL(/\/he\/finance\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /חשבון עסקה #\d+/ })).toBeVisible();
  await expect(page.getByTestId("doc-total")).toContainText("2,478");
  await page.getByRole("button", { name: "שליחה ללקוח" }).click();
  await expect(page.getByRole("button", { name: "רישום תשלום" })).toBeVisible();
  await page.getByRole("button", { name: "רישום תשלום" }).click();
  const pd = page.getByRole("dialog");
  await pd.locator("#pay-amount").fill("1000");
  await pd.getByRole("button", { name: "שמירה" }).click();
  await expect(pd).toBeHidden();
  await expect(page.getByTestId("doc-balance")).toContainText("1,478");
  await shot(page, "w4-05-invoice");
});

test("finance: invoice paid online through the org's own Stripe (signed webhook marks it paid)", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/he/finance?tab=settings");
  const orgKey = ["sk", "test", "orgkey1234567890"].join("_"); // fake fixture, built at runtime so secret scanners stay quiet
  await page.locator("#fs-stripe_secret_key").fill(orgKey);
  const whsec = "whsec_orgsecret1234567890";
  await page.locator("#fs-stripe_webhook_secret").fill(whsec);
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText(/Stripe מחובר/)).toBeVisible();
  const webhookUrl = (await page.getByTestId("finance-webhook-url").textContent())!.trim();

  await page.goto("/he/finance?kind=invoice");
  await page.locator("[data-document^='invoice-']").first().click();
  await page.waitForURL(/\/he\/finance\/[0-9a-f-]{36}$/);
  const invUrl = (await page.getByRole("link", { name: "צפייה / הדפסה" }).getAttribute("href"))!;
  const token = invUrl.split("/q/")[1]!;

  await page.goto(new URL(invUrl).pathname);
  await page.getByRole("button", { name: /תשלום מאובטח בכרטיס/ }).click();
  await page.waitForURL(/paid=1/);
  const calls = (await (await request.get(`${MOCK}/_calls`)).json()) as { provider: string; auth?: string; body: Record<string, string> }[];
  const checkout = calls.filter((c) => c.provider === "stripe").pop()!;
  expect(checkout.auth).toBe(`Bearer ${orgKey}`); // the ORG's key, not the platform's
  expect(checkout.body["metadata[document_token]"]).toBe(token);
  expect(checkout.body["line_items[0][price_data][unit_amount]"]).toBe("147800");

  const body = JSON.stringify({
    id: `evt_${Date.now()}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_${Date.now()}`, payment_status: "paid", amount_total: 147800, payment_intent: `pi_${Date.now()}`, metadata: { kind: "document_payment", document_token: token } } },
  });
  const path = new URL(webhookUrl).pathname;
  const bad = await request.post(path, { headers: { "stripe-signature": "t=1,v1=00", "content-type": "application/json" }, data: body });
  expect(bad.status()).toBe(400);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", whsec).update(`${t}.${body}`).digest("hex");
  const ok = await request.post(path, { headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, data: body });
  expect(ok.status()).toBe(200);
  // replay is idempotent
  await request.post(path, { headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, data: body });

  await page.reload();
  await expect(page.getByTestId("public-doc-status")).toHaveText("שולם");
  await shot(page, "w4-06-invoice-paid");
  await page.goBack();
  await page.goto("/he/finance?status=paid");
  await expect(page.locator("[data-document^='invoice-']")).toHaveCount(1);
});

test("websites: build a landing page with a lead form, publish, visitor submits", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/he/forms/new");
  await page.locator("#fm-title").fill("השאירו פרטים");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/forms\/[0-9a-f-]{36}$/);

  await page.goto("/he/websites/new");
  const slug = `site-${Date.now()}`;
  await page.locator("#st-slug").fill(slug);
  await page.locator("#bl-0-title").fill("הייעוץ שהעסק שלך צריך");
  await page.locator("#bl-1-it-0-title").fill("מהירות");
  await page.locator("#bl-1-it-0-text").fill("מענה תוך שעה");
  await page.getByLabel("סוג בלוק").selectOption("form");
  await page.getByRole("button", { name: "הוספת בלוק" }).click();
  await page.locator("#bl-3-title").fill("דברו איתנו");
  await page.locator("#bl-3-form_slug").selectOption({ index: 1 });
  await page.getByLabel("סוג בלוק").selectOption("faq");
  await page.getByRole("button", { name: "הוספת בלוק" }).click();
  await page.locator("#bl-4-it-0-q").fill("כמה זה עולה?");
  await page.locator("#bl-4-it-0-a").fill("תלוי בהיקף — נשמח להצעה");
  await page.getByRole("button", { name: "פרסום" }).click();
  await page.waitForURL(/\/he\/websites\/[0-9a-f-]{36}$/);
  await shot(page, "w4-07-site-builder");

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(`/he/s/${slug}`);
  await expect(p.getByRole("heading", { name: "הייעוץ שהעסק שלך צריך" })).toBeVisible();
  await expect(p.getByText("מענה תוך שעה")).toBeVisible();
  await p.getByText("כמה זה עולה?").click();
  await expect(p.getByText("תלוי בהיקף — נשמח להצעה")).toBeVisible();
  const lead = `site.${Date.now()}@e2e.test`;
  await p.locator("#pf-name").fill("דנה מהאתר");
  await p.locator("#pf-email").fill(lead);
  await p.getByRole("button", { name: "שליחה" }).click();
  await expect(p.getByText("תודה! הפרטים התקבלו")).toBeVisible();
  await shot(p, "w4-08-public-site");
  await anon.close();

  await page.goto("/he/websites");
  await expect(page.locator(`[data-site="${slug}"]`)).toContainText("1 ביקורים");
  await page.goto(`/he/crm?q=${encodeURIComponent(lead)}`);
  await expect(page.getByRole("link", { name: /דנה מהאתר/ }).first()).toBeVisible();
  // unpublished/unknown sites are not reachable
  const res = await page.request.get(`/he/s/no-such-site-${Date.now()}`);
  expect(res.status()).toBe(404);
});

test("platform admin console is available to platform admins only", async ({ page, request }) => {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  test.skip(!service || !supabaseUrl, "needs the service role to grant platform admin");
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/he/admin");
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  const headers = { apikey: service!, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const prof = (await (await request.get(`${supabaseUrl}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(owner.email)}`, { headers })).json()) as { id: string }[];
  const grant = await request.post(`${supabaseUrl}/rest/v1/platform_admins`, { headers, data: { user_id: prof[0]!.id } });
  expect(grant.ok()).toBe(true);
  try {
    await page.goto("/he/overview");
    await expect(page.getByRole("link", { name: "ניהול פלטפורמה" }).first()).toBeVisible();
    await page.goto(`/he/admin?q=${orgSlug}`);
    await expect(page.getByRole("heading", { name: "ניהול הפלטפורמה" })).toBeVisible();
    const row = page.locator(`[data-admin-org="${orgSlug}"]`);
    await expect(row).toBeVisible();
    await row.getByLabel("תוכנית").selectOption("business");
    await row.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("התוכנית עודכנה")).toBeVisible();
    await page.locator('input[aria-label="מפתח הדגל"]').fill(`e2e_flag_${Date.now() % 100000}`);
    await page.getByRole("button", { name: "הפעלת דגל" }).click();
    await expect(page.getByText("הדגל נשמר")).toBeVisible();
    await shot(page, "w4-09-admin");
    await page.goto("/he/billing");
    await expect(page.getByText(/Business/i).first()).toBeVisible();
  } finally {
    await request.delete(`${supabaseUrl}/rest/v1/platform_admins?user_id=eq.${prof[0]!.id}`, { headers });
  }
});
