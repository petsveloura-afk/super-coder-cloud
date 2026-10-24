import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 21 — WhatsApp (QR): the agent keeps the conversation going.
 *  - an automatic greeting / away message from the business phone does NOT stop the agent
 *  - an echo of the agent's own reply does NOT stop the agent
 *  - the owner really typing does stop it; the inbox says why and when it comes back; one click returns it
 *  - the bridge heartbeat endpoint accepts only signed calls
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const SUPA = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
type Call = { provider: string; kind?: string; to?: string; text?: string };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
const emit = (request: APIRequestContext, event: object) => request.post(`${MOCK}/_wa/emit`, { data: { event } });
async function sends(request: APIRequestContext, to: string) {
  return (await calls(request)).filter((c) => c.provider === "wa-bridge" && c.kind === "send" && c.to === to);
}
async function waitForSends(request: APIRequestContext, to: string, n: number, timeout = 60_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = await sends(request, to);
    if (s.length >= n) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${n} WhatsApp replies to ${to}`);
}
async function aiMode(request: APIRequestContext, to: string) {
  const r = await request.get(`${SUPA}/rest/v1/conversations?select=ai_mode,ai_note&channel=eq.whatsapp_qr&external_id=eq.${to}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return ((await r.json()) as { ai_mode: string; ai_note: string | null }[])[0];
}

test("wave 21: WhatsApp — automatic phone messages never stop the agent; the owner does, and the inbox explains it", async ({ page, request }) => {
  test.skip(!mocked || !KEY, "needs the provider mock and the local stack");
  test.setTimeout(300_000);
  const stamp = Date.now();
  const CUSTOMER = `97254${String(stamp % 10_000_000).padStart(7, "0")}`;
  await signUp(page, { name: "Shira Owner", email: uniqueEmail("w21") });
  await createOrg(page, "מספרת שירה", `w21-${stamp}`);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();

  // connect WhatsApp (bridge stand-in)
  await page.goto("/he/integrations");
  await page.getByTestId("wa-connect").click();
  await expect(page.getByTestId("qr-box").locator("img")).toBeVisible({ timeout: 20_000 });
  expect((await emit(request, { type: "status", status: "connected", phone: "972541234567", name: "מספרת שירה" })).ok()).toBe(true);
  await page.keyboard.press("Escape");

  const now = () => Math.floor(Date.now() / 1000);
  // 1) the customer writes — and the business phone fires its automatic greeting a second later
  await emit(request, { type: "message", id: `IN1-${stamp}`, from: CUSTOMER, name: "דנה", text: "היי, יש תור מחר?", isGroup: false, media: null, ts: now() });
  await emit(request, { type: "owner_message", id: `GREET-${stamp}`, to: CUSTOMER, text: "שלום! תודה שפנית למספרת שירה, נחזור אליך בהקדם 🙏", media: null, ts: now() });
  const first = await waitForSends(request, CUSTOMER, 1);
  expect(first[0]!.text).toMatch(/AUTOPILOT ✓/);
  expect((await aiMode(request, CUSTOMER))!.ai_mode).toBe("auto");

  // 2) the agent's own reply comes back from the phone (echo) → still the agent's conversation
  await emit(request, { type: "owner_message", id: `ECHO-${stamp}`, to: CUSTOMER, text: first[0]!.text, media: null, ts: now() });
  // 3) the customer keeps writing → the agent keeps answering
  await new Promise((r) => setTimeout(r, 1500));
  await emit(request, { type: "message", id: `IN2-${stamp}`, from: CUSTOMER, name: "דנה", text: "ומה המחיר לתספורת?", isGroup: false, media: null, ts: now() });
  await waitForSends(request, CUSTOMER, 2);
  expect((await aiMode(request, CUSTOMER))!.ai_mode).toBe("auto");

  // 4) the owner really answers from the phone (well after the customer's message) → the agent steps back
  await new Promise((r) => setTimeout(r, 7_000));
  await emit(request, { type: "owner_message", id: `OWN-${stamp}`, to: CUSTOMER, text: "היי דנה, כאן שירה 😊 מחר ב-10 מתאים?", media: null, ts: now() });
  await expect.poll(async () => (await aiMode(request, CUSTOMER))?.ai_mode, { timeout: 20_000 }).toBe("human");
  expect((await aiMode(request, CUSTOMER))!.ai_note).toBe("owner_phone");

  // the inbox explains it in plain words, with when the agent comes back, and returns it in one click
  await page.goto("/he/inbox");
  await page.locator("[data-conversation]").first().click();
  const note = page.getByTestId("ai-note");
  await expect(note).toHaveAttribute("data-note", "owner_phone", { timeout: 20_000 });
  await expect(note).toContainText("כתבת ללקוח מהטלפון");
  await expect(note).toContainText(/בעוד (29|30) דקות/);
  // the automatic greeting is in the chat as a phone message (not hidden)
  await expect(page.getByText("שלום! תודה שפנית למספרת שירה").first()).toBeVisible();
  await shot(page, "w21-inbox-note");
  await note.getByTestId("ai-note-resume").click();
  await expect.poll(async () => (await aiMode(request, CUSTOMER))?.ai_mode, { timeout: 20_000 }).toBe("auto");
  await expect(page.getByTestId("ai-note")).toHaveCount(0, { timeout: 20_000 });
  // and the next customer message is answered by the agent again
  await emit(request, { type: "message", id: `IN3-${stamp}`, from: CUSTOMER, name: "דנה", text: "מעולה, תודה!", isGroup: false, media: null, ts: now() });
  await waitForSends(request, CUSTOMER, 3);

  // the bridge heartbeat: only signed calls are accepted
  expect((await request.post("/api/bridge/tick", { data: { at: 1 } })).status()).toBe(401);
  const body = JSON.stringify({ sessions: 1, at: Date.now() });
  const ts = String(Date.now());
  const sig = createHmac("sha256", "wa-bridge-secret-e2e-0123456789").update(`${ts}.${body}`).digest("hex");
  const tick = await request.post("/api/bridge/tick", { headers: { "Content-Type": "application/json", "X-SCC-Timestamp": ts, "X-SCC-Signature": sig }, data: body });
  expect(tick.status()).toBe(200);
});
