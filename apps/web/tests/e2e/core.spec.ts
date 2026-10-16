import { expect, test } from "@playwright/test";
import { createOrg, expectNotFound, shot, signIn, signUp, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

const owner = { name: "טום בודק", email: uniqueEmail("owner") };
const outsider = { name: "Eve Outsider", email: uniqueEmail("eve") };
const invitee = { name: "סייל טסט", email: uniqueEmail("sales") };
const slugA = `org-a-${Date.now()}`;
let contactUrl = "";
let orgAId = "";
let inviteLink = "";

test("unauthenticated users are redirected to a localized login", async ({ page }) => {
  await page.goto("/he/overview");
  await expect(page).toHaveURL(/\/he\/login\?next=/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await shot(page, "01-login-he");

  await page.goto("/en/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.goto("/ar/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await shot(page, "02-login-ar");
});

test("invalid credentials show a translated error", async ({ page }) => {
  await signIn(page, "nobody@e2e.test");
  await expect(page.getByRole("alert").filter({ hasText: "אימייל או סיסמה שגויים" })).toBeVisible();
});

test("sign up → create workspace → empty dashboard with real zero KPIs", async ({ page }) => {
  await signUp(page, owner);
  await shot(page, "03-onboarding");
  await createOrg(page, "סטודיו אלפא", slugA);
  await expect(page.getByText("עדיין אין נתונים")).toBeVisible();
  await shot(page, "04-overview-empty");
});

test("create, view, note, edit and search a contact", async ({ page }) => {
  test.setTimeout(120_000); // long multi-step journey; slow CI browsers must not flake it
  await signIn(page, owner.email);
  await page.waitForURL(/\/he\/overview/);
  await page.goto("/he/crm");
  await page.getByRole("button", { name: "איש קשר חדש" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#firstName").fill("נועה");
  await dialog.locator("#lastName").fill("ברק");
  // Validation: neither email nor phone
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.getByText("יש להזין אימייל או טלפון")).toBeVisible();
  await dialog.locator("#email").fill("noa.barak@e2e.test");
  await dialog.locator("#phone").fill("+972 50-123-4567");
  await dialog.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  contactUrl = page.url();
  await expect(page.locator("h1")).toHaveText("נועה ברק");
  await expect(page.getByText("+972-50-123-4567")).toBeVisible();

  await page.getByPlaceholder("כתבו הערה פנימית…").fill("שיחת היכרות — מעוניינת בחבילת פרימיום");
  await page.getByRole("button", { name: "הוספת הערה" }).click();
  await expect(page.getByText("שיחת היכרות — מעוניינת בחבילת פרימיום")).toBeVisible();

  await page.getByRole("button", { name: "עריכה" }).click();
  await page.getByRole("dialog").locator("#status").selectOption("qualified");
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.locator("main").getByText("מוסמך").first()).toBeVisible();
  await shot(page, "05-contact-detail");

  await page.goto("/he/crm?q=noa.barak");
  await expect(page.getByRole("link", { name: /נועה ברק/ }).first()).toBeVisible();
  await page.goto("/he/crm?q=does-not-exist");
  await expect(page.getByText("לא נמצאו תוצאות")).toBeVisible();

  await page.goto("/he/overview");
  await expect(page.locator("section").getByText("1").first()).toBeVisible();
  await shot(page, "06-overview-with-data");

  const exportLink = page.locator('a[href*="/api/v1/contacts/export?org="]');
  await page.goto("/he/crm");
  orgAId = new URL((await exportLink.getAttribute("href"))!, page.url()).searchParams.get("org")!;
  const res = await page.request.get(`/api/v1/contacts/export?org=${orgAId}`);
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("noa.barak@e2e.test");
});

test("CSV export neutralises formula injection", async ({ page }) => {
  await signIn(page, owner.email);
  await page.waitForURL(/overview/);
  await page.goto("/he/crm?new=1");
  const d = page.getByRole("dialog");
  await d.locator("#firstName").fill("=HYPERLINK(\"http://evil\")");
  await d.locator("#email").fill("formula@e2e.test");
  await d.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  const csv = await (await page.request.get(`/api/v1/contacts/export?org=${orgAId}`)).text();
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
});

test("owner invites a teammate as sales; teammate joins with limited permissions", async ({ page, browser }) => {
  await signIn(page, owner.email);
  await page.waitForURL(/overview/);
  await page.goto("/he/team");
  await page.getByRole("button", { name: "הזמנת חבר צוות" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#invite-email").fill(invitee.email);
  await d.locator("#invite-role").selectOption("sales");
  await d.locator('button[type="submit"]').click();
  inviteLink = (await d.locator("code").textContent())!.trim();
  expect(inviteLink).toContain("/he/onboarding?invite=");
  await shot(page, "07-invite-created");
  if (process.env.E2E_PROVIDERS_MOCKED === "true") {
    // Email provider (Resend) is mocked: the invitation must actually be emailed.
    await expect(d).toContainText("ההזמנה נשלחה במייל");
    const mockBase = process.env.E2E_MOCK_BASE ?? "http://127.0.0.1:4010";
    const sent = (await (await page.request.get(`${mockBase}/resend/_sent`)).json()) as { to: string[]; subject: string }[];
    const mail = sent.find((m) => m.to.includes(invitee.email));
    expect(mail, "invitation email was sent to the invitee").toBeTruthy();
    expect(mail!.subject).toContain("Super Coder Cloud");
  }

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signUp(p2, invitee);
  await p2.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ""));
  await p2.locator('form:has(#token) button[type="submit"]').click();
  await p2.waitForURL(/\/he\/overview/);
  await p2.goto("/he/crm");
  await expect(p2.getByRole("link", { name: /נועה ברק/ }).first()).toBeVisible();
  // sales: no delete, no invite, no export
  await p2.goto(contactUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(p2.getByRole("button", { name: "מחיקה" })).toHaveCount(0);
  await p2.goto("/he/team");
  await expect(p2.getByRole("button", { name: "הזמנת חבר צוות" })).toHaveCount(0);
  const exp = await p2.request.get(`/api/v1/contacts/export?org=${orgAId}`);
  expect(exp.status()).toBe(403);
  await ctx.close();
});

test("a different tenant cannot reach organization A's data by URL or API", async ({ page }) => {
  await signUp(page, outsider);
  await createOrg(page, "Eve Corp", `eve-${Date.now()}`);
  await page.goto(contactUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expectNotFound(page);
  await expect(page.getByText("נועה ברק")).toHaveCount(0);
  const exp = await page.request.get(`/api/v1/contacts/export?org=${orgAId}`);
  expect(exp.status()).toBe(403);
  await page.goto("/he/crm");
  await expect(page.getByText("אין עדיין אנשי קשר")).toBeVisible();
});

test("every module is implemented; unknown modules and the admin console 404 for normal users", async ({ page }) => {
  await signIn(page, owner.email);
  await page.waitForURL(/overview/);
  // all nav modules are live now (no "not implemented" placeholders left)
  for (const m of ["support", "finance", "websites"]) {
    await page.goto(`/he/${m}`);
    await expect(page.getByText(/טרם מומש/)).toHaveCount(0);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/he/not-a-module");
  await expectNotFound(page);
  await page.goto("/he/admin");
  await expectNotFound(page);
});

test("demo data loads into an empty workspace and is clearly labelled", async ({ page }) => {
  await signUp(page, { name: "Demo User", email: uniqueEmail("demo"), locale: "en" });
  await createOrg(page, "Demo Workspace", `demo-${Date.now()}`);
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText(/Demo workspace — data is fictional/)).toBeVisible();
  await page.goto("/en/crm");
  await expect(page.getByText("8 contacts")).toBeVisible();
  await page.goto("/en/overview");
  await shot(page, "08-overview-demo-en");
  await page.goto("/ar/crm");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await shot(page, "09-crm-ar");
  await page.goto("/he/crm");
  await shot(page, "10-crm-he");
});

test("delete a contact", async ({ page }) => {
  await signIn(page, owner.email);
  await page.waitForURL(/overview/);
  await page.goto(contactUrl.replace(/^https?:\/\/[^/]+/, ""));
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "מחיקה" }).click();
  await page.waitForURL(/\/he\/crm\?deleted=1/);
  await page.goto(contactUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expectNotFound(page);
});
