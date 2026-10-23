import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail, upgradeByCrypto } from "./helpers";

/**
 * Waves 15-18 end to end on the real local stack:
 *  - one conversation state: an AI answer plans the 3-hour follow-up, the customer's
 *    reply / a person's reply / "הסר" cancel it at once (shown live in the inbox)
 *  - scheduled message from the inbox, opt-out button
 *  - the new screens: conversation rules, routing, push, conversions, growth (ROI),
 *    credit packs, smart campaign audience, conditional form builder, A/B test, KB, Ctrl+K
 *  - the growth cron
 */
test.describe.configure({ mode: "serial" });

const SUPA = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function rest<T>(request: APIRequestContext, method: "get" | "post" | "patch", path: string, data?: unknown): Promise<T> {
  const r = await request[method](`${SUPA}/rest/v1/${path}`, { headers: H, data });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return (await r.json()) as T;
}

test("waves 15-18: one conversation state + growth screens", async ({ page, request }) => {
  test.skip(!KEY || !SUPA, "needs the local stack service key");
  test.setTimeout(420_000);
  const stamp = Date.now();
  const slug = `w15-${stamp}`;
  await signUp(page, { name: "Growth Owner", email: uniqueEmail("w15") });
  await createOrg(page, "צמיחה בע״מ", slug);
  await upgradeByCrypto(page, "business", slug);

  const org = (await rest<{ id: string }[]>(request, "get", `organizations?select=id&slug=eq.${slug}`))[0]!.id;
  const owner = (await rest<{ user_id: string }[]>(request, "get", `organization_members?select=user_id&organization_id=eq.${org}`))[0]!.user_id;
  const contact = (await rest<{ id: string }[]>(request, "post", "contacts", { organization_id: org, first_name: "דנה", last_name: "לוי", phone: "0541112233", marketing_consent: true, source: "facebook" }))[0]!.id;
  const agent = (await rest<{ id: string }[]>(request, "post", "ai_agents", { organization_id: org, name: "נועה", model: "gemini-flash-latest", followup_hours: 3 }))[0]!.id;
  const conv = (await rest<{ id: string }[]>(request, "post", "conversations", { organization_id: org, channel: "telegram", external_id: String(stamp % 1e9), contact_id: contact, title: "דנה לוי" }))[0]!.id;
  const msg = (body: Record<string, unknown>) => rest(request, "post", "messages", { organization_id: org, conversation_id: conv, ...body });
  const pendingFollowups = async () => (await rest<{ id: string }[]>(request, "get", `conversation_schedules?select=id&conversation_id=eq.${conv}&kind=eq.followup&status=eq.pending`)).length;

  // 1) the customer writes, the AI answers → the 3-hour follow-up is planned and visible
  await msg({ direction: "in", body: "כמה עולה טיפול?" });
  await msg({ direction: "out", body: "150 ₪, רוצה לקבוע?", status: "sent", ai_agent_id: agent });
  expect(await pendingFollowups()).toBe(1);
  await page.goto(`/he/inbox?c=${conv}`);
  const state = page.getByTestId("conversation-state");
  await expect(state).toBeVisible();
  await expect(page.getByTestId("pending-list")).toContainText("מעקב #1");
  await shot(page, "w15-guard-pending");

  // 2) the customer answers → cancelled immediately
  await msg({ direction: "in", body: "אחשוב על זה" });
  expect(await pendingFollowups()).toBe(0);
  await page.reload();
  await expect(page.getByTestId("pending-list")).toHaveCount(0);

  // 3) AI again, then a person answers → cancelled; the AI may not follow up now
  await msg({ direction: "out", body: "בטח!", status: "sent", ai_agent_id: agent });
  expect(await pendingFollowups()).toBe(1);
  await msg({ direction: "out", body: "היי, כאן טום", status: "sent", sent_by: owner });
  expect(await pendingFollowups()).toBe(0);
  await page.reload();
  await expect(state).toContainText("נציג כבר ענה");

  // 4) a scheduled message from the inbox (cancels if the customer replies)
  await page.getByTestId("schedule-open").click();
  await page.locator("#sch-body").fill("תזכורת: ההצעה בתוקף עד יום חמישי");
  await page.getByTestId("schedule-submit").click();
  await expect(page.getByTestId("pending-list")).toContainText("הודעה מתוזמנת");

  // 5) "הסר" on any channel → everything stops, badge shows it
  await msg({ direction: "in", body: "הסר" });
  await page.reload();
  await expect(state).toContainText("ביקש/ה הסרה");
  await expect(page.getByTestId("pending-list")).toHaveCount(0);
  const c = (await rest<{ opted_out_at: string | null; marketing_consent: boolean }[]>(request, "get", `contacts?select=opted_out_at,marketing_consent&id=eq.${contact}`))[0]!;
  expect(c.opted_out_at).not.toBeNull();
  expect(c.marketing_consent).toBe(false);
  await shot(page, "w15-guard-optout");

  // 6) settings: conversation rules, routing, my channels
  await page.goto("/he/settings");
  await expect(page.getByTestId("conversation-policy")).toBeVisible();
  await expect(page.getByTestId("lead-routing")).toBeVisible();
  await expect(page.getByTestId("my-channels")).toBeVisible();

  // 7) integrations: ad conversions
  await page.goto("/he/integrations");
  await expect(page.getByTestId("conversions-card")).toBeVisible();

  // 8) growth analytics: add spend → ROAS
  const inv = (await rest<{ id: string }[]>(request, "post", "documents", { organization_id: org, kind: "invoice", status: "sent", contact_id: contact }))[0]!.id;
  await rest(request, "post", "payments", { organization_id: org, document_id: inv, amount: 1000, method: "transfer" });
  await page.goto("/he/analytics");
  await expect(page.getByTestId("growth-section")).toBeVisible();
  await page.locator("#sp-source").selectOption("facebook");
  await page.locator("#sp-amount").fill("250");
  await page.getByTestId("spend-card").getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByTestId("growth-section")).toContainText("4.00×");
  await shot(page, "w18-growth");

  // 9) billing: AI credit packs
  await page.goto("/he/billing");
  await expect(page.getByTestId("credit-packs")).toBeVisible();
  await expect(page.getByTestId("pack-balance")).toContainText("0");

  // 10) campaigns: smart filters + opted-out never included
  await page.goto("/he/campaigns/new");
  await page.getByText("סינון חכם").click();
  await expect(page.locator("#cp-minscore")).toBeVisible();

  // 11) forms: steps + conditions in the builder
  await page.goto("/he/forms/new");
  await expect(page.getByText("להציג רק אם").first()).toBeVisible();

  // 12) knowledge base page
  await page.goto("/he/support/kb");
  await expect(page.locator("h1")).toContainText("מאגר ידע");

  // 13) Ctrl+K quick actions
  await page.goto("/he/overview");
  const search = page.locator("#global-search").first();
  await search.click();
  await search.fill("קמפ");
  await expect(page.getByRole("option", { name: "קמפיין חדש" })).toBeVisible();
  await page.getByRole("option", { name: "קמפיין חדש" }).click();
  await page.waitForURL(/\/he\/campaigns\/new/);

  // 14) the growth cron runs every step (needs CRON_SECRET on the server — the GitHub CI stack has none, so there only "no secret → 401" is checked)
  expect((await request.post("/api/cron/growth")).status()).toBe(401);
  if (!process.env.CRON_SECRET) return;
  const cron = await request.post("/api/cron/growth", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret-123456"}` } });
  expect(cron.ok()).toBe(true);
  const out = (await cron.json()) as Record<string, unknown>;
  for (const k of ["schedules", "taskReminders", "scores", "appointmentReminders", "abTests", "siteEventsRetention"]) expect(out[k], k).toBeTruthy();
  expect((await request.post("/api/cron/growth")).status()).toBe(401);
});

test("website: behavior tracking endpoint, A/B card", async ({ page, request }) => {
  test.skip(!KEY || !SUPA, "needs the local stack service key");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const slug = `w17-${stamp}`;
  await signUp(page, { name: "Site Owner", email: uniqueEmail("w17") });
  await createOrg(page, "אתר בדיקה", slug);
  await upgradeByCrypto(page, "business", slug);
  const org = (await rest<{ id: string }[]>(request, "get", `organizations?select=id&slug=eq.${slug}`))[0]!.id;
  const siteSlug = `site-${stamp}`;
  const site = (await rest<{ id: string }[]>(request, "post", "sites", { organization_id: org, name: "Landing", slug: siteSlug, status: "published", blocks: [{ type: "hero", data: { title: "כותרת A", subtitle: "", cta_label: "דברו איתנו", cta_href: "", image_url: "" } }] }))[0]!.id;

  // tracking is anonymous and validated
  expect((await request.post("/api/site/track", { data: { slug: siteSlug, visitor: "e2evisitor01", event: "view", path: "/pricing" } })).status()).toBe(204);
  expect((await request.post("/api/site/track", { data: { slug: siteSlug, visitor: "x", event: "view" } })).status()).toBe(400);
  const ev = await rest<{ id: number }[]>(request, "get", `site_events?select=id&site_id=eq.${site}`);
  expect(ev.length).toBe(1);

  // A/B card: variant B + start
  await page.goto(`/he/websites/${site}`);
  const card = page.getByTestId("ab-test-card");
  await expect(card).toBeVisible();
  await card.getByLabel("כותרת").first().fill("כותרת B");
  await card.getByRole("button", { name: "התחלת הבדיקה" }).click();
  await expect(card).toContainText("רצה");
  await shot(page, "w17-ab");

  // the public page shows a variant and keeps it per visitor (cookie)
  const r = await page.goto(`/he/s/${siteSlug}`);
  expect(r?.ok()).toBe(true);
  const h1 = await page.locator("h1").first().innerText();
  expect(["כותרת A", "כותרת B"]).toContain(h1.trim());
  await page.waitForTimeout(800);
  await page.reload();
  expect((await page.locator("h1").first().innerText()).trim()).toBe(h1.trim());
});
