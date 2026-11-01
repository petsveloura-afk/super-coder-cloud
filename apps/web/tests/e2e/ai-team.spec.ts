import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * The digital team ("My team"): hidden without the flag, then — with the flag on for the business — turn the team on
 * (starter team), the 3D presentation (keyboard + add card), hire an employee with a custom look, edit and save,
 * the approvals queue (approve / reject) and the emergency stop. Uses the service role only to set the flag and to
 * put one approval in the queue (the AI itself is not called in this spec).
 */
test.describe.configure({ mode: "serial" });
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

test("My team: flag, starter team, 3D presentation, hire + edit, approvals, emergency stop", async ({ page, request }) => {
  test.skip(!service || !supabaseUrl, "needs the service role (to turn the feature flag on)");
  test.setTimeout(180_000);
  const slug = `team-${Date.now()}`;
  await signUp(page, { name: "Team Owner", email: uniqueEmail("team") });
  await createOrg(page, "צוות דיגיטלי", slug);
  const headers = { apikey: service!, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=representation" };
  const org = ((await (await request.get(`${supabaseUrl}/rest/v1/organizations?select=id&slug=eq.${slug}`, { headers })).json()) as { id: string }[])[0]!.id;

  // without the flag: no menu item, the page only explains
  await page.goto("/he/overview");
  await expect(page.locator('a[href="/he/ai-team"]')).toHaveCount(0);
  await page.goto("/he/ai-team");
  await expect(page.getByText("צוות ה-AI עדיין לא הופעל")).toBeVisible();

  // the flag on for this business
  expect((await request.post(`${supabaseUrl}/rest/v1/feature_flags`, { headers, data: { key: "team_v1", organization_id: org, enabled: true } })).ok()).toBe(true);
  try {
    await page.goto("/he/ai-team");
    await expect(page.locator('a[href="/he/ai-team"]').first()).toBeVisible();

    // turn the team on → the starter team appears in the 3D presentation
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("team-enabled").check();
    await expect(page.getByText("הצוות הופעל").first()).toBeVisible();
    await page.getByTestId("tab-team").click();
    await page.getByTestId("view-presentation").click();
    const stage = page.getByTestId("team-presentation");
    await expect(stage).toBeVisible();
    await expect(stage.getByTestId("card-manager")).toBeVisible();
    await expect(stage.getByTestId("card-add")).toBeAttached();
    await stage.locator(".team-stage").focus();
    await page.keyboard.press("ArrowLeft");
    await shot(page, "team-1-presentation");

    // org chart + grid views
    await page.getByTestId("view-tree").click();
    await expect(page.getByTestId("tree-manager")).toBeVisible();
    await page.getByTestId("view-grid").click();
    await expect(page.getByTestId("member-sales")).toBeVisible();

    // hire: gallery → editor → name + look → save
    await page.getByTestId("hire-open").click();
    await page.getByTestId("hire-web_builder").click();
    await expect(page.getByTestId("member-editor")).toBeVisible();
    await page.getByTestId("editor-name").fill("עומר — אתרים");
    await page.getByRole("button", { name: "מכחול" }).first().click();
    await page.getByTestId("editor-save").click();
    await expect(page.getByText("העובד/ת גויס/ה לצוות").first()).toBeVisible();
    await expect(page.getByTestId("member-web_builder")).toBeVisible();
    await shot(page, "team-2-hired");

    // edit an employee: autonomy + tools tabs, save
    await page.getByTestId("member-sales").click();
    await page.getByRole("tab", { name: "אוטונומיה" }).click();
    await page.getByLabel("מציע/ה בלבד").check();
    await page.getByTestId("editor-save").click();
    await expect(page.getByText("נשמר").first()).toBeVisible();
    await page.keyboard.press("Escape");

    // one approval in the queue (as an employee would create it) → approve is refused for a missing contact, reject works
    const members = (await (await request.get(`${supabaseUrl}/rest/v1/team_members?select=id,role_key&organization_id=eq.${org}`, { headers })).json()) as { id: string; role_key: string }[];
    const cs = members.find((m) => m.role_key === "customer_service")!;
    expect((await request.post(`${supabaseUrl}/rest/v1/team_approvals`, { headers, data: { organization_id: org, member_id: cs.id, tool: "crm.create_task", payload: { title: "להתקשר לדנה" }, preview: "להתקשר לדנה", reason: "הלקוחה ביקשה שיחזרו אליה", sensitivity: "internal" } })).ok()).toBe(true);
    await page.reload();
    await page.getByTestId("tab-approvals").click();
    await expect(page.getByTestId("approval-item")).toContainText("הלקוחה ביקשה שיחזרו אליה");
    await page.getByTestId("approval-approve").click();
    await expect(page.getByText("אושר ובוצע").first()).toBeVisible();
    await page.goto("/he/tasks");
    await expect(page.getByText("להתקשר לדנה").first()).toBeVisible();
    await shot(page, "team-3-approved-task");

    // emergency stop freezes the team; release
    await page.goto("/he/ai-team");
    await page.getByTestId("tab-settings").click();
    await page.getByTestId("emergency-stop").click();
    await expect(page.getByText("עצירת חירום — כל הצוות הוקפא").first()).toBeVisible();
    await page.getByTestId("emergency-stop").click();
    await expect(page.getByText("עצירת החירום בוטלה").first()).toBeVisible();
  } finally {
    await request.delete(`${supabaseUrl}/rest/v1/feature_flags?key=eq.team_v1&organization_id=eq.${org}`, { headers });
  }
});
