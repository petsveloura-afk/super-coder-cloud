import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signIn, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 12 — opening hours (the agent books only at open times and handles "closed"),
 * industry templates, and WhatsApp (QR) run like Telegram Business: the agent manages
 * the chats, and when the owner answers himself from the phone the agent steps back.
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
test.describe.configure({ mode: "serial" });

type Call = { provider: string; kind?: string; to?: string; text?: string; last?: string; hours?: string | null; after?: string | null; script?: boolean };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
async function waitFor(request: APIRequestContext, pick: (c: Call) => boolean, what: string, timeout = 45_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = (await calls(request)).find(pick);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const emit = (request: APIRequestContext, event: object) => request.post(`${MOCK}/_wa/emit`, { data: { event } });
const todayIL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const stamp = Date.now();
const CUSTOMER = `97250${String(stamp % 10_000_000).padStart(7, "0")}`;
const CUSTOMER2 = `97252${String(stamp % 10_000_000).padStart(7, "0")}`;
let ready = false;
const email = uniqueEmail("hours");

test("agent setup: industry template, opening hours, after-hours behaviour and owner take-over are saved", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Salon Owner", email });
  await createOrg(page, "מספרת שירה", `hours-${stamp}`);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();
  await page.goto("/he/ai-agents");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("agent-setup-link").first().click();
  await expect(page.getByTestId("agent-setup")).toBeVisible({ timeout: 20_000 });

  // industry template: beauty salon → script, details, menu and pricing in one click
  await page.locator('[data-industry="beauty"]').click();
  await expect(page.getByTestId("flow-editor").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("menu-editor").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("fields-editor").locator("li")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "מחירים, הנחות ומיקוח" })).toHaveValue(/180/);

  // opening hours: open all week, around the clock (deterministic for the test)
  const hours = page.getByTestId("hours-editor");
  await hours.getByTestId("hours-enabled").check();
  await hours.getByTestId("hours-day-sat").getByRole("checkbox").check();
  const sun = hours.getByTestId("hours-day-sun");
  await sun.getByLabel("ראשון פתיחה").fill("00:00");
  await sun.getByLabel("ראשון סגירה").fill("23:59");
  await sun.getByRole("button", { name: "להעתיק לכל הימים הפתוחים" }).click();
  for (const d of ["mon", "fri", "sat"]) await expect(hours.getByTestId(`hours-day-${d}`).locator('input[type="time"]').first()).toHaveValue("00:00");
  await hours.getByTestId("hours-after").selectOption("closed_message");
  await hours.getByTestId("hours-note").fill("סגורים כרגע, נחזור אליך בפתיחה 🙏");
  // the agent comes back 30 minutes after the owner stops writing
  await page.getByTestId("resume-after").selectOption("30");
  await shot(page, "h1-hours-setup");
  await page.getByTestId("setup-save").click();
  await expect(page.getByText("הסוכן נשמר").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("hours-enabled")).toBeChecked();
  await expect(page.getByTestId("hours-day-sat").locator('input[type="time"]').last()).toHaveValue("23:59");
  await expect(page.getByTestId("hours-after")).toHaveValue("closed_message");
  await expect(page.getByTestId("resume-after")).toHaveValue("30");
  await expect(page.locator('[data-industry="beauty"]')).toHaveClass(/border-accent/);
  ready = true;
});

test("WhatsApp (QR): the agent answers within opening hours, steps back when the owner writes from the phone, and handles 'closed'", async ({ page, request }) => {
  test.skip(!mocked || !ready, "needs the provider mock and the first test");
  test.setTimeout(240_000);
  await signIn(page, email);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  // connect WhatsApp by QR (bridge stand-in)
  await page.goto("/he/integrations");
  await page.getByTestId("wa-connect").click(); // wave 20: one WhatsApp button (QR on a computer, a code on a phone)
  await expect(page.getByTestId("qr-box").locator("img")).toBeVisible({ timeout: 20_000 });
  expect((await emit(request, { type: "status", status: "connected", phone: "972541234567", name: "מספרת שירה" })).ok()).toBe(true);
  await page.keyboard.press("Escape");

  // the main engine is busy → the second engine answers (its request is recorded with the hours state)
  await request.post(`${MOCK}/_busy?ms=120000&only=anthropic`);
  try {
    await emit(request, { type: "message", id: `IN-${stamp}`, from: CUSTOMER, name: "יעל", text: "היי, אפשר תור לתספורת?", isGroup: false, media: null });
    const ans = await waitFor(request, (c) => c.provider === "wa-bridge" && c.kind === "send" && c.to === CUSTOMER && /AUTOPILOT ✓/.test(c.text ?? ""), "agent answer on WhatsApp");
    expect(ans.text).toBeTruthy();
    const ai = (await calls(request)).filter((c) => c.provider === "groq" && c.kind === "autopilot" && c.last?.includes("תור לתספורת")).pop()!;
    expect(ai.hours).toBe("open");
    expect(ai.script).toBe(true); // the beauty-salon script reached the agent

    // the owner answers himself from his phone → recorded, and the agent steps back
    expect((await emit(request, { type: "owner_message", id: `PHONE-${stamp}`, to: CUSTOMER, text: "היי יעל, כאן שירה 🙂 מחר ב-10 מתאים?", media: null })).ok()).toBe(true);
    await page.goto("/he/inbox");
    await page.getByText("יעל").first().click();
    await expect(page.getByTestId("owner-badge")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("מחר ב-10 מתאים?").first()).toBeVisible();
    await shot(page, "h2-owner-takeover");
    const before = (await calls(request)).filter((c) => c.provider === "wa-bridge" && c.to === CUSTOMER).length;
    await emit(request, { type: "message", id: `IN2-${stamp}`, from: CUSTOMER, name: "יעל", text: "מעולה, מחר ב-10 👍", isGroup: false, media: null });
    await new Promise((r) => setTimeout(r, 9_000));
    expect((await calls(request)).filter((c) => c.provider === "wa-bridge" && c.to === CUSTOMER).length).toBe(before);

    // holiday today → closed: the agent says it is closed (business note) and collects details
    await page.goto("/he/ai-agents");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("agent-setup-link").first().click();
    await expect(page.getByTestId("hours-editor")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("hours-holiday").fill(todayIL());
    await page.getByTestId("hours-editor").getByRole("button", { name: "הוספה" }).click();
    await expect(page.getByTestId("hours-editor")).toContainText(todayIL());
    await page.getByTestId("setup-save").click();
    await expect(page.getByText("הסוכן נשמר").first()).toBeVisible();
    await emit(request, { type: "message", id: `IN3-${stamp}`, from: CUSTOMER2, name: "מאיה", text: "אתם פתוחים עכשיו?", isGroup: false, media: null });
    await waitFor(request, (c) => c.provider === "wa-bridge" && c.kind === "send" && c.to === CUSTOMER2, "agent answer while closed");
    const closed = (await calls(request)).filter((c) => c.provider === "groq" && c.kind === "autopilot" && c.last?.includes("פתוחים עכשיו")).pop()!;
    expect(closed.hours).toBe("closed");
    expect(closed.after).toBe("tell the");
  } finally {
    await request.post(`${MOCK}/_busy?ms=0`);
  }
});
