import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 22 — voice notes:
 *  - Telegram Business: the customer's voice note is heard (it was silently ignored before) and answered
 *  - with "voice replies" on, the agent answers a voice note with a real voice message
 *    (OGG/Opus) — Telegram Business (on behalf of the owner) and WhatsApp by QR
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
const SUPA = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
type Call = { provider: string; method?: string; kind?: string; to?: string; ogg?: boolean; mime?: string; opus?: boolean; body?: { chat_id?: string | number | null; business_connection_id?: string | null; text?: string; ogg?: boolean; filename?: string | null; file_id?: string } };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
async function waitFor(request: APIRequestContext, pick: (c: Call) => boolean, what: string, timeout = 60_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const hit = (await calls(request)).find(pick);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function voiceRepliesOn(request: APIRequestContext, slug: string) {
  const org = ((await (await request.get(`${SUPA}/rest/v1/organizations?select=id&slug=eq.${slug}`, { headers: H })).json()) as { id: string }[])[0]!;
  const agents = (await (await request.get(`${SUPA}/rest/v1/ai_agents?select=id,guardrails&organization_id=eq.${org.id}`, { headers: H })).json()) as { id: string; guardrails: Record<string, unknown> | null }[];
  for (const a of agents) await request.patch(`${SUPA}/rest/v1/ai_agents?id=eq.${a.id}`, { headers: H, data: { guardrails: { ...(a.guardrails ?? {}), voice_replies: true } } });
  // wave 55: voice answers are a paid feature — this business uses its 7-day free trial
  await request.post(`${SUPA}/rest/v1/feature_trials`, { headers: H, data: { organization_id: org.id, feature: "voice_notes", ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString() } });
  return org.id;
}
async function lastInbound(request: APIRequestContext, orgId: string, channel: string, externalId: string) {
  const conv = ((await (await request.get(`${SUPA}/rest/v1/conversations?select=id&organization_id=eq.${orgId}&channel=eq.${channel}&external_id=eq.${encodeURIComponent(externalId)}`, { headers: H })).json()) as { id: string }[])[0];
  if (!conv) return null;
  return ((await (await request.get(`${SUPA}/rest/v1/messages?select=body,meta&conversation_id=eq.${conv.id}&direction=eq.in&order=created_at.desc&limit=1`, { headers: H })).json()) as { body: string; meta: Record<string, unknown> }[])[0] ?? null;
}

test("wave 22: voice notes are heard and answered with a voice message (Telegram Business + WhatsApp QR)", async ({ page, request }) => {
  test.skip(!mocked || !KEY, "needs the provider mock and the local stack");
  test.setTimeout(300_000);
  const stamp = Date.now();
  const slug = `w22-${stamp}`;
  const OWNER = 61_000_000 + (stamp % 9_999_999);
  const CUSTOMER = 71_000_000 + (stamp % 9_999_999);
  const CONN = `bc22-${stamp}`;
  await signUp(page, { name: "Voice Owner", email: uniqueEmail("w22") });
  await createOrg(page, "בוטניקה", slug);
  await page.goto("/he/ai-agents");
  await page.getByTestId("quick-agent").click();
  await expect(page.getByText("הסוכן פעיל ועונה ללקוחות")).toBeVisible();

  // ---- Telegram Business
  await page.goto("/he/integrations");
  await page.getByTestId("tg-connect").click();
  const d = page.getByRole("dialog");
  await d.locator("#hub-tg-token").fill("555666222:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1");
  await d.locator('button[type="submit"]').click();
  await expect(page.locator('[data-hub="telegram"]')).toContainText("@scc_test_bot");
  const hook = (await calls(request)).filter((c) => c.method === "setWebhook").pop()! as unknown as { body: { secret_token: string } };
  const token = hook.body.secret_token;
  const post = (data: object) => request.post(`/api/channels/telegram/${token}`, { headers: { "X-Telegram-Bot-Api-Secret-Token": token }, data });
  expect((await post({ update_id: 1, business_connection: { id: CONN, user: { id: OWNER, first_name: "טום" }, user_chat_id: OWNER, date: 1, is_enabled: true, rights: { can_reply: true } } })).ok()).toBe(true);

  // 1) voice replies off: a voice note (no text) is transcribed and answered in text — before wave 22 nothing happened
  expect((await post({ update_id: 2, business_message: { message_id: 10, business_connection_id: CONN, chat: { id: CUSTOMER, type: "private", first_name: "צ'אקי" }, from: { id: CUSTOMER, first_name: "צ'אקי" }, date: 1, voice: { file_id: `VOICE-${stamp}`, mime_type: "audio/ogg", duration: 2 } } })).ok()).toBe(true);
  await waitFor(request, (c) => c.method === "getFile" && c.body?.file_id === `VOICE-${stamp}`, "the voice note is downloaded");
  await waitFor(request, (c) => c.method === "sendMessage" && c.body?.business_connection_id === CONN && String(c.body?.chat_id) === String(CUSTOMER) && /AUTOPILOT ✓/.test(c.body?.text ?? ""), "a text answer to the voice note");
  const orgId = await voiceRepliesOn(request, slug);
  const heard = await lastInbound(request, orgId, "telegram", `biz:${CUSTOMER}`);
  expect(heard?.body).toContain("כמה עולה תספורת לכלב?");
  expect(heard?.meta.transcript).toBe("כמה עולה תספורת לכלב?");
  expect((await calls(request)).some((c) => c.method === "sendVoice" && String(c.body?.chat_id) === String(CUSTOMER))).toBe(false); // other tests may have sent voice notes

  // 2) voice replies on: the answer also comes as a voice message, from the owner's account
  expect((await post({ update_id: 3, business_message: { message_id: 11, business_connection_id: CONN, chat: { id: CUSTOMER, type: "private", first_name: "צ'אקי" }, from: { id: CUSTOMER, first_name: "צ'אקי" }, date: 2, voice: { file_id: `VOICE2-${stamp}`, mime_type: "audio/ogg", duration: 3 } } })).ok()).toBe(true);
  const v = await waitFor(request, (c) => c.method === "sendVoice" && c.body?.business_connection_id === CONN, "a voice answer (Telegram Business)");
  expect(String(v.body?.chat_id)).toBe(String(CUSTOMER));
  expect(v.body?.ogg).toBe(true);
  expect(v.body?.filename).toBe("voice.ogg");
  const tts = (await calls(request)).filter((c) => c.provider === "elevenlabs").pop()!;
  expect(tts.opus).toBe(true);

  // ---- WhatsApp by QR (bridge stand-in): a voice note → transcript → text + voice message
  const WA = `97253${String(stamp % 10_000_000).padStart(7, "0")}`;
  await page.goto("/he/integrations");
  await page.getByTestId("wa-connect").click();
  await expect(page.getByTestId("qr-box").locator("img")).toBeVisible({ timeout: 20_000 });
  expect((await request.post(`${MOCK}/_wa/emit`, { data: { event: { type: "status", status: "connected", phone: "972541112233", name: "בוטניקה" } } })).ok()).toBe(true);
  await page.keyboard.press("Escape");
  const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(300, 5)]).toString("base64");
  await request.post(`${MOCK}/_wa/emit`, { data: { event: { type: "message", id: `PTT-${stamp}`, from: WA, name: "דנה", text: "", isGroup: false, media: { type: "ptt", data: ogg, mime: "audio/ogg; codecs=opus" }, ts: Math.floor(Date.now() / 1000) } } });
  await waitFor(request, (c) => c.provider === "wa-bridge" && c.kind === "send" && c.to === WA, "a text answer on WhatsApp");
  const wv = await waitFor(request, (c) => c.provider === "wa-bridge" && c.kind === "voice" && c.to === WA, "a voice answer on WhatsApp");
  expect(wv.ogg).toBe(true);
  expect(wv.mime).toBe("audio/ogg");
});
