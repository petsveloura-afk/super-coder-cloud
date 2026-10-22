import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/** Wave 6 — the AI agent answers customers by itself (website chat + Telegram), hands off to the team, inbox control. */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

type Call = { provider: string; method?: string; kind?: string; body?: { secret_token?: string; chat_id?: string | number; text?: string } };
async function calls(request: APIRequestContext): Promise<Call[]> {
  return (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
}
async function waitForTelegram(request: APIRequestContext, chat: string, match: RegExp, timeout = 25_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = (await calls(request)).find((c) => c.method === "sendMessage" && String(c.body?.chat_id) === chat && match.test(c.body?.text ?? ""));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no Telegram reply matching ${match} to ${chat}`);
}

test("website chat: the AI agent answers visitors, hands off to the team, the team replies from the inbox", async ({ page, browser }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(180_000);
  const slug = `pilot-${Date.now()}`;
  await signUp(page, { name: "Pilot Owner", email: uniqueEmail("pilot") });
  await createOrg(page, "פט-ליין", slug);

  // one click: a ready agent that answers customers
  await page.goto("/he/ai-agents");
  await expect(page.getByTestId("autopilot-explainer")).toBeVisible();
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();
  await expect(page.getByTestId("autopilot-badges").first()).toContainText("צ׳אט באתר");
  await shot(page, "p1-agents-explainer");

  // integrations hub shows the website chat as ready with the embed code
  await page.goto("/he/integrations");
  const web = page.locator('[data-hub="web"]');
  await expect(web).toContainText("הסוכן עונה כאן אוטומטית");
  await expect(web).toContainText(`data-org="${slug}"`);
  await expect(page.getByTestId("advanced-integrations")).toBeVisible();
  await shot(page, "p2-integrations-hub");

  // a visitor (no account) chats on the embedded page
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/he/chat/${slug}`);
  const panel = v.getByTestId("chat-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox").fill("היי, כמה עולה תספורת לכלב? הטלפון שלי 054-7654321");
  await panel.getByRole("textbox").press("Enter");
  await expect(v.getByTestId("chat-log-public").locator('[data-from="agent"]').last()).toContainText("AUTOPILOT ✓", { timeout: 30_000 });
  await shot(v, "p3-website-chat");

  // the visitor asks for a person → handoff
  await panel.getByRole("textbox").fill("אני רוצה לדבר עם נציג");
  await panel.getByRole("textbox").press("Enter");
  await expect(v.getByTestId("chat-log-public")).toContainText("העברתי את השיחה לצוות", { timeout: 30_000 });

  // the team sees it in the inbox: AI replies marked, waiting for an agent, and can answer
  await page.goto("/he/inbox");
  await expect(page.getByText("ממתין לנציג").first()).toBeVisible();
  await page.locator("[data-conversation]").first().click();
  await expect(page.locator('[data-ai="1"]').first()).toContainText("תשובת AI");
  await expect(page.getByTestId("ai-mode")).toHaveAttribute("data-mode", "human");
  await page.getByRole("textbox", { name: "תשובה" }).fill("היי! כאן נועה מהצוות, תספורת עולה 150 ₪ 🐶");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByText("כאן נועה מהצוות").first()).toBeVisible();
  // the contact was created from the phone the visitor typed
  await page.goto("/he/crm");
  await expect(page.getByText("0547654321").first()).toBeVisible();

  // the visitor receives the team's reply (polling)
  await expect(v.getByTestId("chat-log-public").locator('[data-from="team"]').last()).toContainText("כאן נועה מהצוות", { timeout: 20_000 });
  await visitor.close();

  // switch the conversation back to the AI
  await page.goto("/he/inbox");
  await page.locator("[data-conversation]").first().click();
  await page.getByTestId("ai-mode").click();
  await expect(page.getByTestId("ai-mode")).toHaveAttribute("data-mode", "auto");
});

test("Telegram: the bot answers Start and questions by itself and hands off on a refund request", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(180_000);
  await signUp(page, { name: "Bot Owner", email: uniqueEmail("tgpilot") });
  await createOrg(page, "Bot Co", `tgpilot-${Date.now()}`);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();

  // connect Telegram from the simple hub
  await page.goto("/he/integrations");
  await page.getByTestId("tg-connect").click();
  const d = page.getByRole("dialog");
  await expect(d.getByText("@BotFather")).toBeVisible();
  await d.locator("#hub-tg-token").fill("555666777:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw7");
  await d.locator('button[type="submit"]').click();
  await expect(page.locator('[data-hub="telegram"]')).toContainText("@scc_test_bot");
  await expect(page.locator('[data-hub="telegram"]')).toContainText("הסוכן עונה כאן אוטומטית");

  const token = (await calls(request)).filter((c) => c.method === "setWebhook").pop()!.body!.secret_token!;
  const chat = String(20_000_000 + (Date.now() % 79_999_999));
  const post = (id: number, text: string) =>
    request.post(`/api/channels/telegram/${token}`, {
      headers: { "X-Telegram-Bot-Api-Secret-Token": token },
      data: { update_id: id, message: { message_id: id, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "רון" }, text } },
    });

  expect((await post(1, "/start")).ok()).toBe(true);
  await waitForTelegram(request, chat, /ברוכים הבאים|היי/);

  expect((await post(2, "יש לכם תור פנוי מחר?")).ok()).toBe(true);
  await waitForTelegram(request, chat, /AUTOPILOT ✓/);

  expect((await post(3, "אני רוצה החזר כספי")).ok()).toBe(true);
  await waitForTelegram(request, chat, /מעביר את השיחה לנציג/);
  // the control marker never reaches the customer
  expect((await calls(request)).some((c) => c.method === "sendMessage" && /HANDOFF/.test(c.body?.text ?? ""))).toBe(false);

  await page.goto("/he/inbox");
  await expect(page.getByText("ממתין לנציג").first()).toBeVisible();
  await page.locator("[data-conversation]").first().click();
  await expect(page.locator('[data-ai="1"]')).toHaveCount(3);
  await shot(page, "p4-inbox-telegram-ai");

  // group chats are never answered automatically
  const group = String(-100_000_000 - (Date.now() % 1000));
  await request.post(`/api/channels/telegram/${token}`, {
    headers: { "X-Telegram-Bot-Api-Secret-Token": token },
    data: { update_id: 9, message: { message_id: 9, chat: { id: Number(group), type: "group", title: "קבוצה" }, from: { id: 5, first_name: "x" }, text: "שלום" } },
  });
  await new Promise((r) => setTimeout(r, 4000));
  expect((await calls(request)).some((c) => c.method === "sendMessage" && String(c.body?.chat_id) === group)).toBe(false);
});

type RichCall = Call & { body?: Call["body"] & { parse_mode?: string; reply_markup?: { keyboard?: { text: string; request_contact?: boolean }[][]; remove_keyboard?: boolean } } };

test("the agent closes the lead: share-phone button → contact, hot tag, deal, task, summary, alert, then a follow-up", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(240_000);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  await signUp(page, { name: "Closer Owner", email: uniqueEmail("closer") });
  await createOrg(page, "Closer Co", `closer-${Date.now()}`);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();
  await expect(page.getByTestId("agent-stats")).toBeVisible();

  // the business profile is part of the agent settings
  await page.getByRole("button", { name: "עריכה" }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("agent-profile")).toBeVisible();
  await dlg.locator("#agent-p-services").fill("תספורת כלב קטן: 150 ₪\nאמבטיה: 90 ₪");
  await dlg.locator("#agent-p-hours").fill("א׳-ה׳ 9:00-19:00");
  await expect(dlg.locator("#agent-followup")).toHaveValue("3");
  await dlg.locator('button[type="submit"]').click();
  await expect(dlg).toBeHidden();

  await page.goto("/he/integrations");
  await page.getByTestId("tg-connect").click();
  await page.getByRole("dialog").locator("#hub-tg-token").fill("444555666:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw6");
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-hub="telegram"]')).toContainText("@scc_test_bot");
  await expect(page.locator('[data-hub="telegram"]')).toContainText("הסוכן עונה כאן אוטומטית");
  const token = (await calls(request)).filter((c) => c.method === "setWebhook").pop()!.body!.secret_token!;
  const chat = String(30_000_000 + (Date.now() % 69_999_999));
  const post = (id: number, message: Record<string, unknown>) =>
    request.post(`/api/channels/telegram/${token}`, {
      headers: { "X-Telegram-Bot-Api-Secret-Token": token },
      data: { update_id: id, message: { message_id: id, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "רון" }, ...message } },
    });

  // 1. the agent sees the system prompt with the profile and asks for the phone with a one-tap button
  await post(1, { text: "כמה עולה תספורת?" });
  const ask = (await waitForTelegram(request, chat, /150 ₪/)) as RichCall;
  expect(ask.body?.parse_mode).toBe("HTML");
  expect(ask.body?.reply_markup?.keyboard?.[0]?.[0]?.request_contact).toBe(true);
  expect(ask.body?.text).not.toContain("ASK_PHONE");
  expect((await calls(request)).some((c) => c.method === "sendChatAction")).toBe(true);

  // 2. the customer taps "share my phone" → the lead is closed
  await post(2, { contact: { phone_number: "+972541112233", first_name: "רון" } });
  const done = (await waitForTelegram(request, chat, /רשמתי/)) as RichCall;
  expect(done.body?.text).not.toContain("LEAD");

  await page.goto("/he/inbox");
  await page.locator("[data-conversation]").first().click();
  await expect(page.getByTestId("lead-info")).toContainText("ליד חם");
  await expect(page.getByText(/רוצה תספורת לכלב מחר בבוקר/).first()).toBeVisible();
  await page.goto("/he/crm?q=541112233");
  await expect(page.getByText(/רון/).first()).toBeVisible();
  await expect(page.getByText("מוסמך").first()).toBeVisible();
  await page.goto("/he/pipelines");
  await expect(page.getByText("תספורת לכלב · AI").first()).toBeVisible();
  await page.goto("/he/tasks");
  await expect(page.getByText(/Follow up: רון/).first()).toBeVisible();
  await page.goto("/he/settings");
  await expect(page.getByText(/ליד חדש מהסוכן: רון/).first()).toBeVisible();
  await page.goto("/he/ai-agents");
  await expect(page.getByTestId("agent-stats")).toContainText("1");

  // 3. silence → one automatic follow-up (cron)
  test.skip(!service || !supabaseUrl, "needs the service role");
  const headers = { apikey: service!, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const old = new Date(Date.now() - 5 * 3600_000).toISOString();
  // waves 15-18: the conversation guard reads the real "last automated / last customer" times, so the silence is simulated on them too
  const patched = await request.patch(`${supabaseUrl}/rest/v1/conversations?channel=eq.telegram&external_id=eq.${chat}`, { headers, data: { last_message_at: old, last_auto_at: old, last_customer_at: old } });
  expect(patched.ok()).toBe(true);
  const fu = await request.post("/api/ai/followups", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret-123456"}` } });
  expect(fu.ok()).toBe(true);
  expect(((await fu.json()) as { sent: number }).sent).toBeGreaterThanOrEqual(1);
  await waitForTelegram(request, chat, /רק מזכיר/);
  // never twice
  await request.patch(`${supabaseUrl}/rest/v1/conversations?channel=eq.telegram&external_id=eq.${chat}`, { headers, data: { last_message_at: old, last_auto_at: old, last_customer_at: old } });
  const again = await request.post("/api/ai/followups", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret-123456"}` } });
  expect(((await again.json()) as { sent: number }).sent).toBe(0);
});

test("website chat: quick-reply buttons and the details form when the agent asks for the phone", async ({ page, browser }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(150_000);
  const slug = `chips-${Date.now()}`;
  await signUp(page, { name: "Chips Owner", email: uniqueEmail("chips") });
  await createOrg(page, "Chips Co", slug);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();

  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/he/chat/${slug}`);
  const panel = v.getByTestId("chat-panel");
  await panel.getByRole("textbox").fill("מה יש לכם?");
  await panel.getByRole("textbox").press("Enter");
  const chips = v.getByTestId("chat-quick-replies");
  await expect(chips).toBeVisible({ timeout: 30_000 });
  await expect(chips.getByRole("button")).toHaveCount(3);
  await expect(v.getByTestId("chat-log-public")).not.toContainText("BUTTONS");
  await chips.getByRole("button", { name: "אמבטיה" }).click();
  await expect(v.getByTestId("chat-log-public").locator('[data-from="me"]').last()).toContainText("אמבטיה");
  await panel.getByRole("textbox").fill("כמה עולה?");
  await panel.getByRole("textbox").press("Enter");
  await expect(v.getByPlaceholder("טלפון")).toBeVisible({ timeout: 30_000 });
  await v.getByPlaceholder("שם").fill("דנה");
  await v.getByPlaceholder("טלפון").fill("0529998877");
  await v.getByRole("button", { name: "הוספה" }).click();
  await expect(v.getByTestId("chat-log-public")).toContainText("רשמתי", { timeout: 30_000 });
  await shot(v, "p5-chat-chips");
  await visitor.close();
  await page.goto("/he/crm");
  await expect(page.getByText("0529998877").first()).toBeVisible();
});
