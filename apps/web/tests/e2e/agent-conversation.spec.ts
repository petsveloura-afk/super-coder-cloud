import { deflateSync } from "node:zlib";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signIn, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 8 — the agent runs the whole conversation the way the business set it up:
 * script (ordered steps), pricing & negotiation policy, menu buttons on Start,
 * Telegram commands, example photos from the gallery, and it never "goes silent"
 * when the AI provider is busy (hold message + safety net answers by itself).
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-123456";
test.describe.configure({ mode: "serial" });

type Call = {
  provider: string;
  method?: string;
  kind?: string;
  last?: string;
  body?: { secret_token?: string; chat_id?: string | number; text?: string; photo?: string; caption?: string; commands?: { command: string }[]; reply_markup?: { keyboard?: { text: string }[][] } };
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

/** a tiny valid PNG (8×8, teal) */
function png(): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c >>> 0) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [20, 184, 166]).flat())])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

let token = "";
let slug = "";
let email = "";

test("conversation setup through the UI → Telegram menu on Start, commands, the business script, pricing policy and example photos", async ({ page, request, browser }) => {
  test.skip(!mocked, "needs the provider mock");
  test.setTimeout(240_000);
  slug = `convo-${Date.now()}`;
  email = uniqueEmail("convo");
  await signUp(page, { name: "Convo Owner", email });
  await createOrg(page, "מספרת הכלבים", slug);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();

  // connect the Telegram bot (token only) → commands + menu button are configured automatically
  await page.goto("/he/integrations");
  await page.getByTestId("tg-connect").click();
  const d = page.getByRole("dialog");
  await d.locator("#hub-tg-token").fill("555666888:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw8");
  await d.locator('button[type="submit"]').click();
  await expect(page.locator('[data-hub="telegram"]')).toContainText("@scc_test_bot");
  const cmds = await waitFor(request, (c) => c.method === "setMyCommands", "setMyCommands");
  expect(cmds.body?.commands?.map((c) => c.command)).toEqual(expect.arrayContaining(["start", "menu", "prices", "book", "human"]));
  await waitFor(request, (c) => c.method === "setChatMenuButton", "setChatMenuButton");
  token = (await calls(request)).filter((c) => c.method === "setWebhook").pop()!.body!.secret_token!;

  // the conversation setup page
  await page.goto("/he/ai-agents");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("agent-setup-link").first().click();
  await expect(page).toHaveURL(/\/setup$/, { timeout: 20_000 });
  await expect(page.getByTestId("agent-setup")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("flow-template").click();
  const flow = page.getByTestId("flow-editor");
  await expect(flow.locator("li")).toHaveCount(8);
  // reorder: move step 2 to the top
  const second = await flow.locator("li").nth(1).locator("input").inputValue();
  await flow.locator("li").nth(1).getByRole("button", { name: "למעלה" }).click();
  await expect(flow.locator("li").first().locator("input")).toHaveValue(second);
  // required details
  const fields = page.getByTestId("fields-editor");
  await fields.getByRole("textbox").last().fill("גודל הכלב");
  await fields.getByRole("textbox").last().press("Enter");
  await expect(fields.locator("li")).toHaveCount(1);
  // pricing & negotiation
  await page.getByRole("textbox", { name: "מחירים, הנחות ומיקוח" }).fill("עד 10% הנחה למי שמזמין שני טיפולים");
  // links
  const links = page.getByTestId("links-editor");
  await links.getByRole("textbox").last().fill("אתר | https://dogs.example.com");
  await links.getByRole("button", { name: "הוספה" }).click();
  // menu buttons
  const menu = page.getByTestId("menu-editor");
  for (const b of ["💰 מחירים", "📅 קביעת תור", "🖼️ דוגמאות"]) {
    await menu.getByRole("textbox").last().fill(b);
    await menu.getByRole("textbox").last().press("Enter");
  }
  await expect(menu.locator("li")).toHaveCount(3);
  // gallery: upload an example photo and name it
  await page.getByTestId("media-file").setInputFiles({ name: "before-after.png", mimeType: "image/png", buffer: png() });
  const item = page.getByTestId("media-item");
  await expect(item).toHaveCount(1, { timeout: 20_000 });
  await item.getByRole("textbox", { name: "שם (למשל: לפני ואחרי)" }).fill("לפני ואחרי");
  await shot(page, "c1-agent-setup");
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("הסוכן נשמר").first()).toBeVisible();
  // saved settings survive a reload
  await page.reload();
  await expect(page.getByTestId("flow-editor").locator("li").first().locator("input")).toHaveValue(second);
  await expect(page.getByTestId("media-item")).toHaveCount(1);

  // Telegram customer
  const chat = String(30_000_000 + (Date.now() % 69_999_999));
  let n = 100;
  const post = (text: string) =>
    request.post(`/api/channels/telegram/${token}`, {
      headers: { "X-Telegram-Bot-Api-Secret-Token": token },
      data: { update_id: ++n, message: { message_id: n, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "דנה" }, text } },
    });
  const toChat = (c: Call) => String(c.body?.chat_id) === chat;

  // Start → greeting + the business's menu as buttons
  expect((await post("/start")).ok()).toBe(true);
  const hello = await waitFor(request, (c) => c.method === "sendMessage" && toChat(c) && Boolean(c.body?.reply_markup?.keyboard), "start menu");
  expect(hello.body!.reply_markup!.keyboard!.flat().map((b) => b.text)).toEqual(["💰 מחירים", "📅 קביעת תור", "🖼️ דוגמאות"]);

  // /prices → understood as a prices question
  expect((await post("/prices")).ok()).toBe(true);
  await waitFor(request, (c) => c.kind === "autopilot" && c.last === "מה המחירים?", "prices intent");
  await waitFor(request, (c) => c.method === "sendMessage" && toChat(c) && /150/.test(c.body?.text ?? ""), "prices answer");

  // the agent follows the business script and pricing policy
  expect((await post("בדיקת תסריט")).ok()).toBe(true);
  const scripted = await waitFor(request, (c) => c.method === "sendMessage" && toChat(c) && /SCRIPT\[/.test(c.body?.text ?? ""), "scripted answer");
  expect(scripted.body!.text).toContain(`SCRIPT[${second}]`);
  expect(scripted.body!.text).toContain("POLICY[עד 10% הנחה למי שמזמין שני טיפולים]");

  // examples → the photo from the gallery is sent
  expect((await post("אפשר לראות דוגמאות?")).ok()).toBe(true);
  const photo = await waitFor(request, (c) => c.method === "sendPhoto" && toChat(c), "example photo");
  expect(photo.body!.photo).toContain("/storage/v1/object/public/site-assets/");
  expect((await calls(request)).some((c) => c.method === "sendMessage" && /SEND_MEDIA/.test(c.body?.text ?? ""))).toBe(false);

  // the inbox shows the photo in the conversation
  await page.goto("/he/inbox");
  await page.locator("[data-conversation]").first().click();
  await expect(page.locator('[data-ai="1"]').first()).toBeVisible();
  await expect(page.getByTestId("inbox-image").first()).toBeVisible();
  await shot(page, "c2-inbox-convo");

  // the website chat shows the same menu buttons as quick starts
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/he/chat/${slug}`);
  const chips = v.getByTestId("chat-menu");
  await expect(chips).toContainText("💰 מחירים");
  await chips.getByRole("button", { name: "🖼️ דוגמאות" }).click();
  await expect(v.getByTestId("chat-image").first()).toBeVisible({ timeout: 30_000 });
  await shot(v, "c3-website-chat-menu");
  await visitor.close();
});

test("busy AI provider: the customer gets a short hold message, the conversation stays with the agent and the safety net answers", async ({ page, request }) => {
  test.skip(!mocked || !token, "needs the provider mock and the previous test");
  test.setTimeout(420_000);
  await request.post(`${MOCK}/_busy?ms=120000`);
  const chat = String(40_000_000 + (Date.now() % 59_999_999));
  const toChat = (c: Call) => String(c.body?.chat_id) === chat;
  const r = await request.post(`/api/channels/telegram/${token}`, {
    headers: { "X-Telegram-Bot-Api-Secret-Token": token },
    data: { update_id: 900, message: { message_id: 900, chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "יוסי" }, text: "יש לכם תור מחר?" } },
  });
  expect(r.ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && toChat(c) && /קיבלתי/.test(c.body?.text ?? ""), "hold message", 60_000);
  // never the old "a person will get back to you" + handoff
  expect((await calls(request)).some((c) => c.method === "sendMessage" && toChat(c) && /נציג מהצוות יחזור/.test(c.body?.text ?? ""))).toBe(false);

  // the provider is back; the safety net (cron) answers the waiting customer by itself
  await request.post(`${MOCK}/_busy?ms=0`);
  await new Promise((res) => setTimeout(res, 62_000));
  const run = await request.post("/api/ai/followups", { headers: { Authorization: `Bearer ${CRON}` } });
  expect(run.ok()).toBe(true);
  await waitFor(request, (c) => c.method === "sendMessage" && toChat(c) && /AUTOPILOT ✓/.test(c.body?.text ?? ""), "safety-net answer", 60_000);
  // only one hold message
  expect((await calls(request)).filter((c) => c.method === "sendMessage" && toChat(c) && /קיבלתי/.test(c.body?.text ?? ""))).toHaveLength(1);

  // still handled by the agent (not waiting for a person)
  await signIn(page, email);
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30_000 });
  await page.goto("/he/inbox");
  await page.locator("[data-conversation]").first().click();
  await expect(page.getByTestId("ai-mode")).toHaveAttribute("data-mode", "auto");
});
