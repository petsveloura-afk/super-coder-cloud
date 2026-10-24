import { createHash, createHmac, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail, upgradeByCrypto } from "./helpers";

/**
 * Wave 19 end to end on the real local stack:
 *  - the AI team hub (switch on, run now, work log), social page (post draft), marketplace tiles
 *  - REST hooks for Zapier / Make (subscribe / list / unsubscribe) with an API key
 *  - WooCommerce order webhook → order + contact; agents cron
 *  - Instagram Direct + comments through the Meta webhook (when META_APP_SECRET is set for the server)
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

test("wave 19: AI team, social, marketplace, REST hooks, store + Meta webhooks", async ({ page, request }) => {
  test.skip(!KEY || !SUPA, "needs the local stack service key");
  test.setTimeout(420_000);
  const stamp = Date.now();
  const slug = `w19-${stamp}`;
  await signUp(page, { name: "Team Owner", email: uniqueEmail("w19") });
  await createOrg(page, "צוות חכם בע״מ", slug);
  await upgradeByCrypto(page, "business", slug);
  const org = (await rest<{ id: string }[]>(request, "get", `organizations?select=id&slug=eq.${slug}`))[0]!.id;

  // 1) the AI team hub: switch the sales manager on, run the analyst now → the log shows what it did
  await page.goto("/he/agents");
  await expect(page.getByTestId("agents-hub")).toBeVisible();
  await expect(page.locator("[data-agent]")).toHaveCount(4);
  await page.getByTestId("agent-toggle-sales_manager").check();
  await expect(page.getByText("הסוכן הופעל").first()).toBeVisible();
  await page.getByTestId("agent-run-analyst").click();
  await expect(page.getByTestId("agent-log-analyst")).toBeVisible({ timeout: 60_000 });
  await shot(page, "w19-agents");

  // 2) social: a post draft from the calendar
  await page.goto("/he/social");
  await expect(page.getByTestId("social-page")).toBeVisible();
  await page.locator('[data-tab="posts"]').click();
  await page.getByTestId("post-new").click();
  await page.getByTestId("post-editor").locator("textarea").fill("מבצע סתיו: 10% הנחה לטיפוח מלא 🍂");
  await page.getByRole("button", { name: "לשמור כטיוטה" }).click();
  await expect(page.locator('[data-post="draft"]').first()).toBeVisible();
  await shot(page, "w19-social");

  // 3) the marketplace: every category with its one-click tile.
  // wave 20: a tile that still needs the platform's one-time setup (Meta / Google / Shopify keys not set
  // here) is shown to platform admins only — a customer never sees setup instructions.
  await page.goto("/he/integrations");
  await expect(page.getByTestId("marketplace")).toBeVisible();
  for (const id of ["woocommerce", "zapier"]) await expect(page.locator(`[data-market="${id}"]`)).toBeVisible();
  for (const id of ["meta", "wa-app", "google", "shopify"]) await expect(page.locator(`[data-market="${id}"]`)).toHaveCount(0);
  await expect(page.getByText("בעל הפלטפורמה צריך")).toHaveCount(0);
  await page.getByRole("tab", { name: "חנויות אונליין" }).click();
  await expect(page.locator('[data-market="zapier"]')).toHaveCount(0);
  await expect(page.locator('[data-market="woocommerce"]')).toBeVisible();
  await shot(page, "w19-marketplace");

  // 4) REST hooks (Zapier / Make) with an API key that has webhooks.manage
  const apiKey = `scc_live_${randomBytes(24).toString("base64url")}`;
  await rest(request, "post", "api_keys", { organization_id: org, name: "zapier", prefix: apiKey.slice(0, 16), key_hash: createHash("sha256").update(apiKey).digest("hex"), scopes: ["webhooks.manage", "events.read"] });
  const auth = { Authorization: `Bearer ${apiKey}` };
  const sub = await request.post("/api/public/v1/hooks", { headers: auth, data: { target_url: "https://93.184.215.14/hooks/catch/1/abc/", event: "order.created" } });
  expect(sub.status()).toBe(201);
  const hookId = ((await sub.json()) as { id: string }).id;
  expect((await request.post("/api/public/v1/hooks", { headers: auth, data: { target_url: "https://hooks.zapier.com/x", event: "nope" } })).status()).toBe(422);
  expect((await request.post("/api/public/v1/hooks", { headers: auth, data: { target_url: "http://127.0.0.1/x", event: "order.created" } })).status()).toBe(422);
  const list = (await (await request.get("/api/public/v1/hooks", { headers: auth })).json()) as { data: { id: string }[] };
  expect(list.data.map((h) => h.id)).toContain(hookId);
  expect((await request.get("/api/public/v1/samples?event=order.created", { headers: auth })).ok()).toBe(true);

  // 5) WooCommerce: a signed order webhook → the order, a new contact, order.created (→ the REST hook job)
  const hook = randomBytes(24).toString("hex");
  await rest(request, "post", "integrations", { organization_id: org, provider: "woocommerce", status: "active", config: { origin: "https://shop.example.co.il", hook_hash: createHash("sha256").update(hook).digest("hex"), state: "connected" } });
  const order = JSON.stringify({ id: 9001, number: "9001", status: "processing", total: "240.00", currency: "ILS", billing: { first_name: "נועה", last_name: "כהן", email: `noa.${stamp}@shop.test`, phone: "0549998877" }, line_items: [{ name: "קולר", quantity: 2, price: 120 }] });
  const sig = createHmac("sha256", hook).update(order).digest("base64");
  const wh = await request.post(`/api/stores/woocommerce/webhook?h=${hook}`, { headers: { "Content-Type": "application/json", "X-WC-Webhook-Signature": sig, "X-WC-Webhook-Topic": "order.created" }, data: order });
  expect(wh.ok()).toBe(true);
  expect((await request.post(`/api/stores/woocommerce/webhook?h=${hook}`, { headers: { "Content-Type": "application/json", "X-WC-Webhook-Signature": "bad", "X-WC-Webhook-Topic": "order.created" }, data: order })).status()).toBe(401);
  const orders = await rest<{ total: number; contact_id: string }[]>(request, "get", `store_orders?select=total,contact_id&organization_id=eq.${org}`);
  expect(orders).toHaveLength(1);
  expect(Number(orders[0]!.total)).toBe(240);
  const jobs = await rest<{ id: string }[]>(request, "get", `jobs?select=id&organization_id=eq.${org}&kind=eq.webhook&webhook_id=eq.${hookId}`);
  expect(jobs.length).toBeGreaterThanOrEqual(1);
  expect((await request.delete(`/api/public/v1/hooks/${hookId}`, { headers: auth })).status()).toBe(204);

  // 6) the agents cron
  expect((await request.post("/api/cron/agents")).status()).toBe(401);
  if (process.env.CRON_SECRET) {
    const cron = await request.post("/api/cron/agents", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(cron.ok()).toBe(true);
  }

  // 7) Instagram Direct + a comment through the Meta webhook (signed with the app secret)
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (/^[a-f0-9]{32}$/i.test(appSecret)) {
    const igId = String(17_841_400_000 + (stamp % 1000));
    await rest(request, "post", "channel_accounts", { organization_id: org, kind: "instagram", name: "@w19", status: "active", config: { ig_id: igId, page_id: "1" } });
    const post = async (body: unknown) => {
      const raw = JSON.stringify(body);
      return request.post("/api/channels/meta/pages", { headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}` }, data: raw });
    };
    expect((await post({ object: "instagram", entry: [{ id: igId, messaging: [{ sender: { id: "5551234" }, recipient: { id: igId }, message: { mid: `m.${stamp}`, text: "היי, יש לכם תור מחר?" } }] }] })).ok()).toBe(true);
    const convs = await rest<{ id: string; channel: string }[]>(request, "get", `conversations?select=id,channel&organization_id=eq.${org}&channel=eq.instagram`);
    expect(convs).toHaveLength(1);
    expect((await post({ object: "instagram", entry: [{ id: igId, changes: [{ field: "comments", value: { id: `ic.${stamp}`, text: "כמה עולה?", from: { id: "77", username: "dana" }, media: { id: "m1" } } }] }] })).ok()).toBe(true);
    const comments = await rest<{ body: string; sentiment: string }[]>(request, "get", `social_comments?select=body,sentiment&organization_id=eq.${org}`);
    expect(comments[0]).toMatchObject({ body: "כמה עולה?", sentiment: "lead" });
    expect((await request.post("/api/channels/meta/pages", { headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=00" }, data: "{}" })).status()).toBe(401);
    await page.goto("/he/social");
    await expect(page.locator("[data-comment]").first()).toContainText("כמה עולה?");
  }
});
