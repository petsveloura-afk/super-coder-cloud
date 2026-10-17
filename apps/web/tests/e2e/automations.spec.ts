import { expect, test, type Page } from "@playwright/test";
import { createOrg, openAdvanced, shot, signUp, uniqueEmail, upgradeByCrypto } from "./helpers";

/**
 * Wave 2: automations (builder + engine), public API keys, inbound webhooks,
 * outbound e-mail jobs and the Telegram channel. Provider-dependent steps run
 * only when E2E_PROVIDERS_MOCKED=true (local mock of Resend/Telegram).
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_BASE ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

const owner = { name: "Automation Owner", email: uniqueEmail("auto") };

async function newContact(page: Page, first: string, email: string) {
  await page.goto("/he/crm?new=1");
  const d = page.getByRole("dialog");
  await d.locator("#firstName").fill(first);
  await d.locator("#email").fill(email);
  await d.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
}

test("template automation runs instantly when a contact is created", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, owner);
  await createOrg(page, "Auto Co", `auto-${Date.now()}`);
  await page.goto("/he/automations");
  await expect(page.getByRole("heading", { name: "אוטומציות", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /ליד חדש → משימת שיחה/ }).click();
  await expect(page.locator("#a-name")).toHaveValue("ליד חדש → משימת שיחה");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/automations\/[0-9a-f-]{36}$/);
  await shot(page, "w2-01-builder");

  await newContact(page, "רונית", `ronit.${Date.now()}@e2e.test`);
  // the task created by the automation is on the contact page
  await expect(page.getByText(/📞 רונית/)).toBeVisible();
  await expect(page.getByText("new-lead", { exact: true })).toBeVisible();

  await page.goto("/he/automations");
  await expect(page.getByText("הצליחה").first()).toBeVisible();
  // toggle off → creating another contact does not run it
  await page.getByRole("switch", { name: "פעילה" }).click();
  await expect(page.getByRole("switch", { name: "פעילה" })).toHaveAttribute("aria-checked", "false");
  await newContact(page, "שקט", `quiet.${Date.now()}@e2e.test`);
  await expect(page.getByText(/📞 שקט/)).toHaveCount(0);
});

test("API key → public REST API (create contact, me, events) with scopes enforced", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill((await import("./helpers")).PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);
  // wave 13: the REST API is part of the Business plan — a free workspace sees the upgrade note
  await page.goto("/he/integrations");
  await openAdvanced(page);
  await expect(page.getByTestId("upgrade-api_access")).toBeVisible();
  await upgradeByCrypto(page, "business");
  await page.goto("/he/integrations");
  await openAdvanced(page);
  await expect(page.getByTestId("upgrade-api_access")).toHaveCount(0);
  await page.getByRole("button", { name: "מפתח חדש" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#key-name").fill("Zapier");
  await d.getByLabel("יצירה ועדכון אנשי קשר").check();
  await d.locator('button[type="submit"]').click();
  const key = (await page.getByTestId("new-api-key").textContent())!.trim();
  expect(key).toMatch(/^scc_live_/);
  await shot(page, "w2-02-integrations");

  const auth = { Authorization: `Bearer ${key}` };
  const me = await request.get("/api/public/v1/me", { headers: auth });
  expect(me.status()).toBe(200);
  expect((await me.json()).organization.name).toBe("Auto Co");

  const email = `api.${Date.now()}@e2e.test`;
  const created = await request.post("/api/public/v1/contacts", { headers: auth, data: { first_name: "Api", last_name: "Lead", email, phone: "050-999-8888", tags: ["zapier"] } });
  expect(created.status()).toBe(201);
  const contact = (await created.json()).data;
  expect(contact).toMatchObject({ first_name: "Api", email, phone: "0509998888", source: "api" });
  const upsert = await request.post("/api/public/v1/contacts", { headers: auth, data: { first_name: "Api2", email } });
  expect(upsert.status()).toBe(200);
  expect((await upsert.json()).created).toBe(false);
  const patched = await request.patch(`/api/public/v1/contacts/${contact.id}`, { headers: auth, data: { status: "customer" } });
  expect((await patched.json()).data.status).toBe("customer");

  const list = await request.get(`/api/public/v1/contacts?email=${encodeURIComponent(email)}`, { headers: auth });
  expect((await list.json()).total).toBe(1);
  expect((await request.post("/api/public/v1/contacts", { headers: auth, data: { first_name: "" } })).status()).toBe(422);
  expect((await request.post("/api/public/v1/deals", { headers: auth, data: { title: "x" } })).status()).toBe(403); // no deals.write scope
  expect((await request.post("/api/public/v1/tasks", { headers: auth, data: { title: "x" } })).status()).toBe(403); // no tasks.write scope
  expect((await request.get("/api/public/v1/deals", { headers: auth })).status()).toBe(200); // deals.read is granted
  const events = (await (await request.get("/api/public/v1/events?type=contact.created", { headers: auth })).json()) as { data: { entity_id: string }[] };
  expect(events.data.some((e) => e.entity_id === contact.id)).toBe(true);
  expect((await request.get("/api/public/v1/me", { headers: { Authorization: "Bearer scc_live_invalidinvalidinvalidinvalid" } })).status()).toBe(401);
  expect((await request.get("/api/public/v1/me")).status()).toBe(401);

  // the contact shows up in the CRM with its tag
  await page.goto(`/he/crm/${contact.id}`);
  await expect(page.getByText("zapier", { exact: true })).toBeVisible();

  // revoke → 401
  page.once("dialog", (dl) => dl.accept());
  await page.goto("/he/integrations");
  await openAdvanced(page);
  await page.getByRole("button", { name: "ביטול" }).first().click();
  await expect(page.getByText("בוטל", { exact: true })).toBeVisible();
  expect((await request.get("/api/public/v1/me", { headers: auth })).status()).toBe(401);
});

test("inbound webhook automation creates and tags a lead", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill((await import("./helpers")).PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);
  await page.goto("/he/automations/new?recipe=inboundLead");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/automations\/[0-9a-f-]{36}$/);
  const url = (await page.locator("code", { hasText: "/api/hooks/" }).textContent())!.trim();
  const path = new URL(url).pathname;
  const email = `hook.${Date.now()}@e2e.test`;
  const res = await request.post(path, { data: { name: "Hook Lead", email, utm_source: "facebook" } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  await page.goto(`/he/crm/${body.contact_id}`);
  await expect(page.locator("h1")).toHaveText("Hook Lead");
  await expect(page.getByText("inbound", { exact: true })).toBeVisible();
  expect((await request.post("/api/hooks/" + "0".repeat(48), { data: {} })).status()).toBe(404);
});

test("e-mail action is delivered through the job queue", async ({ page }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill((await import("./helpers")).PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);
  await page.goto("/he/automations/new");
  await page.locator("#a-name").fill("Welcome mail");
  await page.locator("#a-trigger").selectOption("contact.created");
  await page.getByLabel("סוג פעולה").first().selectOption("send_email");
  await page.locator("#act-0-subject").fill("ברוכה הבאה {{contact.first_name}}");
  await page.locator("#act-0-ebody").fill("שלום {{contact.first_name}}, תודה שפנית ל-{{org.name}}");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/automations\/[0-9a-f-]{36}$/);
  const email = `mail.${Date.now()}@e2e.test`;
  await newContact(page, "מיכל", email);
  await expect
    .poll(async () => {
      const sent = (await (await page.request.get(`${MOCK}/resend/_sent`)).json()) as { to: string[]; subject: string }[];
      return sent.find((m) => m.to.includes(email))?.subject ?? null;
    }, { timeout: 30_000 })
    .toBe("ברוכה הבאה מיכל");
});

test("Telegram channel: connect, inbound message creates a contact, automation replies", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  await page.goto("/he/login");
  await page.locator("#email").fill(owner.email);
  await page.locator("#password").fill((await import("./helpers")).PASSWORD);
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/overview/);

  // reply automation
  await page.goto("/he/automations/new");
  await page.locator("#a-name").fill("Telegram auto-reply");
  await page.locator("#a-trigger").selectOption("message.received");
  await page.getByLabel("סוג פעולה").first().selectOption("send_telegram");
  await page.locator("#act-0-msg").fill("היי {{contact.first_name}}, קיבלנו ונחזור בקרוב 🙏");
  await page.getByRole("button", { name: "שמירה" }).click();
  await page.waitForURL(/\/he\/automations\/[0-9a-f-]{36}$/);

  await page.goto("/he/integrations");
  await openAdvanced(page);
  const card = page.locator('[data-channel="telegram"]');
  await card.getByRole("button", { name: "חיבור" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#ch-telegram-bot_token").fill("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw8");
  await d.locator('button[type="submit"]').click();
  await expect(card.getByText("@scc_test_bot")).toBeVisible();
  await shot(page, "w2-03-channels");

  const calls = (await (await request.get(`${MOCK}/_calls`)).json()) as { provider: string; method?: string; body: { url?: string; secret_token?: string; chat_id?: string; text?: string } }[];
  const hook = calls.filter((c) => c.provider === "telegram" && c.method === "setWebhook").pop()!;
  expect(hook.body.url).toContain("/api/channels/telegram/");
  const token = hook.body.secret_token!;
  const chatId = String(100_000_000 + (Date.now() % 899_999_999)); // no leading zero

  // a forged request is rejected
  expect((await request.post(`/api/channels/telegram/${token}`, { data: {}, headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" } })).status()).toBe(401);
  const inbound = await request.post(`/api/channels/telegram/${token}`, {
    headers: { "X-Telegram-Bot-Api-Secret-Token": token },
    data: { update_id: 1, message: { message_id: 10, chat: { id: Number(chatId), type: "private" }, from: { id: Number(chatId), first_name: "אבי", last_name: "טסט" }, text: "שלום, אפשר פרטים?" } },
  });
  expect(inbound.status()).toBe(200);

  await expect
    .poll(async () => {
      const all = (await (await request.get(`${MOCK}/_calls`)).json()) as typeof calls;
      return all.find((c) => c.provider === "telegram" && c.method === "sendMessage" && String(c.body.chat_id) === chatId)?.body.text ?? null;
    }, { timeout: 30_000 })
    .toBe("היי אבי, קיבלנו ונחזור בקרוב 🙏");

  await page.goto("/he/crm?q=אבי");
  await expect(page.getByRole("link", { name: /אבי טסט/ }).first()).toBeVisible();
});
