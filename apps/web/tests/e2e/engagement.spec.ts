import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, createOrg, openAdvanced, shot, signUp, uniqueEmail } from "./helpers";

/** Wave 3: public forms, booking pages + appointments, campaigns with unsubscribe, omnichannel inbox. */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_BASE ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

const owner = { name: "Engage Owner", email: uniqueEmail("engage") };

async function login(page: Page) {
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);
}

test("public form → contact in the CRM (validation, honeypot-safe, no login needed)", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signUp(page, owner);
  await createOrg(page, "Engage Co", `engage-${Date.now()}`);
  await page.goto("/he/forms");
  await page.getByRole("link", { name: "טופס חדש" }).first().click();
  await page.locator("#fm-title").fill("דברו איתנו");
  await page.locator("#fm-tag").fill("טופס-אתר");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/forms\/[0-9a-f-]{36}$/);
  const url = (await page.getByTestId("public-url").textContent())!.trim();
  await shot(page, "w3-01-form-builder");

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(new URL(url).pathname);
  await expect(p.getByRole("heading", { name: "דברו איתנו" })).toBeVisible();
  await p.getByRole("button", { name: "שליחה" }).click();
  await expect(p.getByText("שדה חובה").first()).toBeVisible();
  const email = `form.${Date.now()}@e2e.test`;
  await p.locator("#pf-name").fill("נטע אורן");
  await p.locator("#pf-email").fill(email);
  await p.locator("#pf-phone").fill("052-123-4567");
  await p.locator("#pf-message").fill("מעוניינת בהצעה");
  await p.getByRole("button", { name: "שליחה" }).click();
  await expect(p.getByText("תודה! הפרטים התקבלו")).toBeVisible();
  await shot(p, "w3-02-public-form");
  await anon.close();

  await page.goto(`/he/crm?q=${encodeURIComponent(email)}`);
  await page.getByRole("link", { name: /נטע אורן/ }).first().click();
  await expect(page.getByText("טופס-אתר", { exact: true })).toBeVisible();
  await expect(page.getByText(/מעוניינת בהצעה/)).toBeVisible();
});

test("booking page: customer books a free slot, team sees it, customer cancels", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/he/appointments?tab=pages");
  await page.getByRole("button", { name: "דף קביעת פגישות חדש" }).click();
  const d = page.getByRole("dialog");
  // open every day, all day, so the test is independent of when it runs
  for (const day of ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]) {
    const box = d.getByRole("checkbox", { name: new RegExp(day) });
    if (!(await box.isChecked())) await box.check();
  }
  for (const input of await d.locator('input[type="time"]').all()) {
    const label = (await input.getAttribute("aria-label")) ?? "";
    await input.fill(label.includes("עד") ? "23:30" : "00:00");
  }
  await d.locator("#bt-notice").fill("0");
  await d.getByRole("button", { name: "שמירה" }).click();
  await expect(d).toBeHidden();
  const url = (await page.locator("[data-booking-type]").getByTestId("public-url").textContent())!.trim();

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(new URL(url).pathname);
  await expect(p.getByRole("heading", { name: "שיחת היכרות" })).toBeVisible();
  const firstSlot = p.getByRole("option").first();
  await firstSlot.click();
  await p.locator("#bk-name").fill("עמית לקוח");
  await p.locator("#bk-email").fill(`book.${Date.now()}@e2e.test`);
  await p.getByRole("button", { name: /קביעת פגישה ל-/ }).click();
  await expect(p.getByText("הפגישה נקבעה!")).toBeVisible();
  await shot(p, "w3-03-booking");
  const cancelHref = await p.getByRole("link", { name: /לבטל/ }).getAttribute("href");

  await page.bringToFront(); // a background tab never runs requestAnimationFrame, so streamed content would stay hidden
  await page.goto("/he/appointments");
  await expect(page.getByText(/שיחת היכרות — עמית לקוח/)).toBeVisible({ timeout: 30_000 }); // streamed page on slow CI browsers

  await p.goto(cancelHref!);
  await p.getByRole("button", { name: "כן, בטלו" }).click();
  await expect(p.getByText("הפגישה בוטלה")).toBeVisible();
  await anon.close();
  await page.bringToFront();
  await page.reload();
  await expect(page.getByText("בוטלה").first()).toBeVisible();
});

test("e-mail campaign reaches opted-in contacts only and the unsubscribe link works", async ({ page }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(180_000);
  await login(page);
  const optIn = `optin.${Date.now()}@e2e.test`;
  const optOut = `optout.${Date.now()}@e2e.test`;
  for (const [first, email, consent] of [["מסכימה", optIn, true], ["לא-מסכים", optOut, false]] as const) {
    await page.goto("/he/crm?new=1");
    const dlg = page.getByRole("dialog");
    await dlg.locator("#firstName").fill(first);
    await dlg.locator("#email").fill(email);
    if (consent) await dlg.getByRole("checkbox").check();
    await dlg.locator('button[type="submit"]').click();
    await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  }
  await page.goto("/he/campaigns/new");
  await page.locator("#cp-name").fill("מבצע סתיו");
  await page.locator("#cp-subject").fill("מבצע ל-{{contact.first_name}}");
  await page.locator("#cp-body").fill("שלום {{contact.first_name}}, 20% הנחה ב-{{org.name}}");
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await page.waitForURL(/\/he\/campaigns\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "ספירת נמענים" }).click();
  await expect(page.getByRole("status").filter({ hasText: /נמענים/ })).toContainText(/\d+ נמענים/);
  page.once("dialog", (dl) => dl.accept());
  await page.getByRole("button", { name: "שליחה עכשיו" }).click();
  await expect(page.getByText(/הקמפיין יצא ל-/)).toBeVisible();

  type Sent = { to: string[]; subject: string; text: string; headers: Record<string, string> | null };
  let mail: Sent | undefined;
  await expect
    .poll(async () => {
      const sent = (await (await page.request.get(`${MOCK}/resend/_sent`)).json()) as Sent[];
      mail = sent.find((m) => m.to.includes(optIn));
      return mail?.subject ?? null;
    }, { timeout: 30_000 })
    .toBe("מבצע ל-מסכימה");
  const all = (await (await page.request.get(`${MOCK}/resend/_sent`)).json()) as Sent[];
  expect(all.some((m) => m.to.includes(optOut))).toBe(false);
  expect(mail!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

  await page.reload();
  await expect(page.getByText("נשלח").first()).toBeVisible();
  const unsub = mail!.text.match(/https?:\/\/\S+\/c\/unsubscribe\/[a-f0-9]{32}/)![0];
  await page.goto(new URL(unsub).pathname);
  await page.getByRole("button", { name: "כן, הסירו אותי" }).click();
  await expect(page.getByText(/הוסרתם מרשימת התפוצה/)).toBeVisible();
});

test("inbox: inbound Telegram message appears, agent replies from the inbox", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/he/inbox");
  await expect(page.getByText(/עוד לא חיברתם ערוץ הודעות/)).toBeVisible();
  await page.goto("/he/integrations");
  await openAdvanced(page);
  await page.locator('[data-channel="telegram"]').getByRole("button", { name: "חיבור" }).click();
  await page.getByRole("dialog").locator("#ch-telegram-bot_token").fill("987654321:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9");
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.locator('[data-channel="telegram"]').getByText("@scc_test_bot")).toBeVisible();
  const calls = (await (await request.get(`${MOCK}/_calls`)).json()) as { provider: string; method?: string; body: { secret_token?: string; chat_id?: string; text?: string } }[];
  const token = calls.filter((c) => c.method === "setWebhook").pop()!.body.secret_token!;
  const chat = String(10_000_000 + (Date.now() % 89_999_999)); // no leading zero (Telegram ids are numbers)
  await request.post(`/api/channels/telegram/${token}`, {
    headers: { "X-Telegram-Bot-Api-Secret-Token": token },
    data: { update_id: 5, message: { message_id: 1, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "שירה" }, text: "יש לכם שירות בשבת?" } },
  });

  await page.goto("/he/inbox");
  const conv = page.locator("[data-conversation]").filter({ hasText: "שירה" });
  await expect(conv).toBeVisible();
  await expect(conv).toContainText("יש לכם שירות בשבת?");
  await conv.click();
  await page.getByLabel("תשובה").fill("כן, עד 14:00 🙂");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByText("כן, עד 14:00 🙂")).toBeVisible();
  await expect(page.getByText(/נשלחה/).first()).toBeVisible();
  const after = (await (await request.get(`${MOCK}/_calls`)).json()) as typeof calls;
  expect(after.some((c) => c.method === "sendMessage" && String(c.body.chat_id) === chat && c.body.text === "כן, עד 14:00 🙂")).toBe(true);
  await shot(page, "w3-04-inbox");
  await page.getByRole("button", { name: "סגירה" }).click();
  await page.goto("/he/inbox?f=closed");
  await expect(page.locator("[data-conversation]").filter({ hasText: "שירה" })).toBeVisible();
});
