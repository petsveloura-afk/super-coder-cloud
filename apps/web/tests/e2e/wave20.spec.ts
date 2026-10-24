import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * Wave 20 end to end:
 *  - WhatsApp in one button: QR on a computer, an 8-character code for the phone (bridge stand-in)
 *  - customers never see the platform's setup instructions; the admin console has the setup wizard
 *  - the overview's "AI at work" band
 */
const mocked = process.env.E2E_PROVIDERS_MOCKED === "true";
const MOCK = process.env.E2E_MOCK_URL ?? "http://127.0.0.1:4010";
type Call = { provider: string; kind?: string; phone?: string };
const calls = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/_calls`)).json()) as Call[];
const emit = (request: APIRequestContext, event: object) => request.post(`${MOCK}/_wa/emit`, { data: { event } });

test("wave 20: WhatsApp by QR or phone code, no setup text for customers, the AI band, the admin setup wizard", async ({ page, request }) => {
  test.setTimeout(300_000);
  const email = uniqueEmail("w20");
  const slug = `w20-${Date.now()}`;
  await signUp(page, { name: "Shira Levi", email });
  await createOrg(page, "שירה עיצוב שיער", slug);

  // the overview opens with what the agent did today (no agent yet → a one-click start)
  await expect(page.getByTestId("ai-pulse")).toBeVisible();
  await expect(page.getByTestId("ai-pulse")).toContainText("הסוכן עוד לא עונה ללקוחות");
  await expect(page.getByTestId("ai-pulse").locator("li")).toHaveCount(4);

  // integrations: one WhatsApp card at the top, no instructions meant for the platform owner
  await page.goto("/he/integrations");
  const hero = page.getByTestId("wa-hero");
  await expect(hero).toBeVisible();
  await expect(page.getByText("בעל הפלטפורמה צריך")).toHaveCount(0);
  await expect(page.locator('[data-hub="whatsapp_qr"]')).toHaveCount(0); // no duplicate WhatsApp cards

  if (mocked) {
    // computer → the QR tab first
    await page.getByTestId("wa-connect").click();
    await expect(page.getByTestId("wa-tab-qr")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("qr-box").locator("img")).toBeVisible({ timeout: 20_000 });
    await shot(page, "w20-wa-qr");
    // the same phone → an 8-character code
    await page.getByTestId("wa-tab-code").click();
    await page.getByTestId("wa-pair-phone").fill("12");
    await page.getByTestId("wa-pair-submit").click();
    await expect(page.getByText("המספר לא תקין")).toBeVisible();
    await page.getByTestId("wa-pair-phone").fill("054-123-4567");
    await page.getByTestId("wa-pair-submit").click();
    await expect(page.getByTestId("wa-pair-code")).toHaveText("K7Q2-M9XA", { timeout: 20_000 });
    expect((await calls(request)).some((c) => c.provider === "wa-bridge" && c.kind === "pair" && c.phone === "054-123-4567")).toBe(true);
    await shot(page, "w20-wa-code");
    // the person typed the code on the phone → linked; the dialog notices by itself
    expect((await emit(request, { type: "status", status: "connected", phone: "972541234567", name: "שירה" })).ok()).toBe(true);
    await expect(page.getByTestId("wa-done")).toBeVisible({ timeout: 20_000 });
    await expect(hero).toContainText("+972541234567", { timeout: 20_000 });
    await expect(hero).toContainText("מחובר מהטלפון");
  }

  // the admin console: the one-time platform setup wizard (platform admins only)
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (service && supabaseUrl) {
    const headers = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
    const prof = (await (await request.get(`${supabaseUrl}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}`, { headers })).json()) as { id: string }[];
    expect((await request.post(`${supabaseUrl}/rest/v1/platform_admins`, { headers, data: { user_id: prof[0]!.id } })).ok()).toBe(true);
    try {
      // as a platform admin, the tiles that still need setup show a link to the wizard
      // the page streams in (loading boundary); on the loaded sandbox browser a stalled stream is retried
      await expect(async () => {
        await page.goto("/he/integrations");
        await expect(page.getByTestId("wa-hero")).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 60_000 });
      await expect(page.locator('[data-market="meta"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("setup-meta")).toHaveAttribute("href", "/he/admin#setup");
      await page.goto("/he/admin");
      const wiz = page.getByTestId("platform-setup");
      await expect(wiz).toBeVisible();
      await expect(wiz.locator("[data-step]")).toHaveCount(6);
      // the bridge is configured here (stand-in) → step 1 is done; Meta isn't → its webhook address is ready to copy
      // with the bridge stand-in (local stack) step 1 is done; in CI there is no bridge → still to do
      await expect(wiz.locator('[data-step="bridge"]')).toContainText(mocked ? "מוכן" : "לביצוע");
      await wiz.locator('[data-step="wa_official"] summary').click();
      await expect(wiz.locator('[data-step="wa_official"]')).toContainText("/api/channels/meta/whatsapp");
      await wiz.locator('[data-step="wa_official"]').getByRole("button", { name: "יצירת טוקן אימות" }).click();
      await expect(wiz.locator('[data-step="wa_official"] code').filter({ hasText: /^[a-f0-9]{48}$/ })).toHaveCount(1);
      if (mocked) {
        await page.getByTestId("setup-check").click();
        await expect(page.getByTestId("live-bridge")).toBeVisible({ timeout: 20_000 });
      }
      await shot(page, "w20-admin-setup");
    } finally {
      await request.delete(`${supabaseUrl}/rest/v1/platform_admins?user_id=eq.${prof[0]!.id}`, { headers });
    }
  }
});
