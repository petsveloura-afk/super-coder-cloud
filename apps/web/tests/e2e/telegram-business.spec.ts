import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";
import { addKnownPrice } from "./known-prices";

/**
 * Wave 10 — Telegram Business (the bot runs the owner's personal Telegram chats)
 * and team updates (invite Telegram / e-mail recipients to get conversations,
 * leads and handoffs).
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

type Call = {
  provider: string;
  method?: string;
  body?: { secret_token?: string; chat_id?: string | number; text?: string; business_connection_id?: string; reply_markup?: unknown; allowed_updates?: string[] };
};
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
async function waitFor(request: APIRequestContext, pick: (c: Call) => boolean, what: string, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = (await calls(request)).find(pick);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("Telegram Business: the agent answers in the owner's own chats, steps back when he types, and the team gets updates", async ({ page, request }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const OWNER = 60_000_000 + (stamp % 9_999_999);
  const CUSTOMER = 70_000_000 + (stamp % 9_999_999);
  const TEAM_CHAT = 80_000_000 + (stamp % 9_999_999);
  const CONN = `bc-${stamp}`;
  const teamEmail = `team-${stamp}@example.com`;

  await signUp(page, { name: "Biz Owner", email: uniqueEmail("tgbiz") });
  await createOrg(page, "מספרת טום", `tgbiz-${stamp}`);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();
  await addKnownPrice(request, `tgbiz-${stamp}`, "תספורת לכלב: 150 ₪"); // v15: only prices from the business information

  // connect the bot — the webhook asks Telegram for Business updates too
  await page.goto("/he/integrations");
  await page.getByTestId("tg-connect").click();
  const d = page.getByRole("dialog");
  await d.locator("#hub-tg-token").fill("555666111:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1");
  await d.locator('button[type="submit"]').click();
  await expect(page.locator('[data-hub="telegram"]')).toContainText("@scc_test_bot");
  const hook = (await calls(request)).filter((c) => c.method === "setWebhook").pop()!;
  expect(hook.body!.allowed_updates).toEqual(expect.arrayContaining(["message", "business_connection", "business_message", "callback_query"]));
  const token = hook.body!.secret_token!;
  const post = (data: object) => request.post(`/api/channels/telegram/${token}`, { headers: { "X-Telegram-Bot-Api-Secret-Token": token }, data });
  let uid = 1000;

  // the owner adds the bot in Telegram → Settings → Telegram Business → Chatbots
  expect((await post({ update_id: ++uid, business_connection: { id: CONN, user: { id: OWNER, first_name: "טום", username: "tom_biz" }, user_chat_id: OWNER, date: 1, is_enabled: true, rights: { can_reply: true } } })).ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && String(c.body?.chat_id) === String(OWNER) && /מחובר לחשבון/.test(c.body?.text ?? ""), "owner confirmation");
  await page.reload();
  await expect(page.getByTestId("tg-business-row")).toContainText("מחובר ועונה");
  await expect(page.getByTestId("tg-business-row")).toContainText("@tom_biz");

  // team updates: a Telegram recipient (invite link → Start) for every conversation + leads, and an e-mail for leads
  const box = page.getByTestId("team-updates");
  await box.locator('[data-kind="telegram"]').click();
  await box.getByText("כל שיחה", { exact: true }).click();
  await box.getByTestId("notify-add").click();
  const invite = await box.getByTestId("notify-invite").first().textContent();
  const code = /start=n_([A-Za-z0-9]+)/.exec(invite ?? "")?.[1];
  expect(code).toBeTruthy();
  expect(invite).toContain("https://t.me/scc_test_bot?start=n_");
  expect((await post({ update_id: ++uid, message: { message_id: 1, chat: { id: TEAM_CHAT, type: "private" }, from: { id: TEAM_CHAT, first_name: "דני" }, text: `/start n_${code}` } })).ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && String(c.body?.chat_id) === String(TEAM_CHAT) && /מחובר!/.test(c.body?.text ?? ""), "recipient linked");
  await box.locator('[data-kind="email"]').click();
  await box.getByTestId("notify-target").fill(teamEmail);
  await box.getByTestId("notify-add").click();
  await expect(page.locator('[data-recipient="email"]')).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-recipient="telegram"]')).toHaveAttribute("data-linked", "1");
  await expect(page.locator('[data-recipient="email"]')).toContainText(teamEmail);
  await shot(page, "b1-team-updates");

  // a customer writes to the owner's personal account → the agent answers in that chat, on the owner's behalf
  const biz = (text: string, from = CUSTOMER) => post({ update_id: ++uid, business_message: { message_id: uid, business_connection_id: CONN, chat: { id: CUSTOMER, type: "private", first_name: "דנה" }, from: { id: from, first_name: from === OWNER ? "טום" : "דנה" }, text } });
  expect((await biz("היי, כמה עולה תספורת?")).ok()).toBe(true);
  const reply = await waitFor(request, (c) => c.method === "sendMessage" && c.body?.business_connection_id === CONN && String(c.body?.chat_id) === String(CUSTOMER) && /150/.test(c.body?.text ?? ""), "agent reply in the business chat");
  expect(reply.body!.reply_markup).toBeUndefined();
  await waitFor(request, (c) => c.method === "sendChatAction" && c.body?.business_connection_id === CONN, "typing in the business chat");
  // the team member gets the exchange
  await waitFor(request, (c) => c.method === "sendMessage" && String(c.body?.chat_id) === String(TEAM_CHAT) && /💬/.test(c.body?.text ?? "") && /כמה עולה תספורת/.test(c.body?.text ?? ""), "conversation update to the team");

  // the customer leaves a phone → lead → Telegram + e-mail updates
  expect((await biz("מעולה, הטלפון שלי 054-7654321")).ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && String(c.body?.chat_id) === String(TEAM_CHAT) && /ליד חם/.test(c.body?.text ?? "") && /0547654321|054-7654321/.test(c.body?.text ?? ""), "lead update on Telegram");
  const until = Date.now() + 30_000;
  let mail: { to: string | string[]; subject: string } | undefined;
  while (!mail && Date.now() < until) {
    const sent = (await (await request.get(`${MOCK}/resend/_sent`)).json()) as { to: string | string[]; subject: string }[];
    mail = sent.find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(teamEmail) && /ליד/.test(m.subject));
    if (!mail) await new Promise((r) => setTimeout(r, 500));
  }
  expect(mail?.subject).toContain("ליד חם");

  // the owner types himself → recorded, the agent steps back in this chat
  expect((await biz("דנה, כאן טום — אני אטפל בזה אישית 🙂", OWNER)).ok()).toBe(true);
  await page.goto("/he/inbox");
  const row = page.locator("[data-conversation]").filter({ hasText: "דנה" }).first();
  await row.click();
  await expect(page.getByText("כאן טום — אני אטפל בזה אישית").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("ai-mode")).toHaveAttribute("data-mode", "human");
  await shot(page, "b2-inbox-business");
  const before = (await calls(request)).filter((c) => c.method === "sendMessage" && c.body?.business_connection_id === CONN).length;
  expect((await biz("תודה טום!")).ok()).toBe(true);
  await new Promise((r) => setTimeout(r, 6000));
  const after = (await calls(request)).filter((c) => c.method === "sendMessage" && c.body?.business_connection_id === CONN).length;
  expect(after).toBe(before); // no new automatic reply in the owner's chat

  // the bot's own echo and deleted messages are ignored safely
  expect((await post({ update_id: ++uid, business_message: { message_id: uid, business_connection_id: CONN, chat: { id: CUSTOMER, type: "private" }, from: { id: OWNER }, sender_business_bot: { id: 777, is_bot: true }, text: "echo" } })).ok()).toBe(true);
  expect((await post({ update_id: ++uid, deleted_business_messages: { business_connection_id: CONN, chat: { id: CUSTOMER, type: "private" }, message_ids: [1] } })).ok()).toBe(true);

  // the owner disconnects the bot in Telegram
  expect((await post({ update_id: ++uid, business_connection: { id: CONN, user: { id: OWNER, first_name: "טום", username: "tom_biz" }, user_chat_id: OWNER, date: 2, is_enabled: false, rights: { can_reply: true } } })).ok()).toBe(true);
  await page.goto("/he/integrations");
  await expect(page.getByTestId("tg-business-row")).toContainText("מנותק");

  // the team member stops the updates from Telegram
  expect((await post({ update_id: ++uid, message: { message_id: 2, chat: { id: TEAM_CHAT, type: "private" }, from: { id: TEAM_CHAT }, text: "/stop_updates" } })).ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && String(c.body?.chat_id) === String(TEAM_CHAT) && /הופסקו/.test(c.body?.text ?? ""), "stop confirmation");
  await page.reload();
  await expect(page.locator('[data-recipient="telegram"]')).toContainText("מושהה");
});
