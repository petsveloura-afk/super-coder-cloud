import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/** Wave 1: companies, deals Kanban, won/lost, tasks, analytics, CSV import, tags, duplicate merge. */
test.describe.configure({ mode: "serial" });

const owner = { name: "מנהלת מכירות", email: uniqueEmail("suite") };

test("companies, deals board, won deal, tasks and analytics — end to end", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, owner);
  await createOrg(page, "סוויטה בע״מ", `suite-${Date.now()}`);

  // Company
  await page.goto("/he/companies");
  await expect(page.getByText("אין עדיין חברות")).toBeVisible();
  await page.getByRole("button", { name: "חברה חדשה" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("#company-name").fill("אקמה טכנולוגיות");
  await dialog.locator("#company-domain").fill("https://acme.example.com/about");
  await dialog.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/companies\/[0-9a-f-]{36}$/);
  await expect(page.locator("h1")).toHaveText("אקמה טכנולוגיות");
  await expect(page.getByText("acme.example.com")).toBeVisible();

  // Deal from the pipelines board
  await page.goto("/he/pipelines");
  await expect(page.getByRole("region", { name: "לוח עסקאות" })).toBeVisible();
  for (const stage of ["חדש", "מוסמך", "הצעת מחיר", "משא ומתן"]) {
    await expect(page.getByRole("heading", { name: stage, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "עסקה חדשה" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("#deal-title").fill("רישיון שנתי");
  await dialog.locator("#deal-value").fill("12000");
  await dialog.locator("#deal-company").selectOption({ label: "אקמה טכנולוגיות" });
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  const card = page.locator("li[data-deal-id]").filter({ hasText: "רישיון שנתי" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("אקמה טכנולוגיות");

  // Move with the accessible "move to" control
  const newCol = page.locator('section[data-stage-id]').filter({ has: page.getByRole("heading", { name: "חדש", exact: true }) });
  const proposalCol = page.locator('section[data-stage-id]').filter({ has: page.getByRole("heading", { name: "הצעת מחיר", exact: true }) });
  await expect(newCol.locator("li[data-deal-id]")).toHaveCount(1);
  const proposalId = await proposalCol.getAttribute("data-stage-id");
  await card.locator("select").selectOption(proposalId!);
  await expect(proposalCol.locator("li[data-deal-id]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator('section[data-stage-id]').filter({ has: page.getByRole("heading", { name: "הצעת מחיר", exact: true }) }).locator("li[data-deal-id]")).toHaveCount(1);
  await shot(page, "w1-01-board");

  // Mark as won → leaves the board, appears under "won"
  await page.locator("li[data-deal-id]").filter({ hasText: "רישיון שנתי" }).getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "זכייה" }).click();
  await expect(page.locator("li[data-deal-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: "זכיות" }).click();
  await expect(page.getByText("רישיון שנתי")).toBeVisible();

  // Task: create, complete
  await page.goto("/he/tasks");
  await page.getByRole("button", { name: "משימה חדשה" }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("#task-title").fill("להתקשר ללקוח");
  await dialog.locator("#task-due").fill("2020-01-01T10:00");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByText("להתקשר ללקוח")).toBeVisible();
  await expect(page.getByText("באיחור").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /להתקשר ללקוח/ }).check();
  await page.getByRole("tab", { name: "בוצעו" }).click();
  await expect(page.getByText("להתקשר ללקוח")).toBeVisible();

  // Analytics shows the real won revenue
  await page.goto("/he/analytics");
  await expect(page.getByRole("heading", { name: "ניתוח נתונים" })).toBeVisible();
  await expect(page.getByText("1 זכיות").first()).toBeVisible();
  await expect(page.getByText(/12,000/).first()).toBeVisible();
  await shot(page, "w1-02-analytics");

  // Navigation no longer marks these modules as "not implemented"
  await expect(page.getByRole("link", { name: "צינורות מכירה" }).first()).not.toContainText("P2");
});

test("CSV import, tags and duplicate merge", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page, { name: "Importer", email: uniqueEmail("import") });
  await createOrg(page, "Import Co", `import-${Date.now()}`);
  await page.goto("/he/crm");
  await page.getByRole("button", { name: "ייבוא CSV" }).click();
  const csv = [
    "שם מלא,מייל,טלפון,סטטוס",
    "דנה כהן,dana@import.test,050-111-2222,לקוח",
    "דנה כהן,,050-111-2222,",
    "בלי פרטים,,,",
    "יוסי לוי,yossi@import.test,,ליד",
  ].join("\n");
  await page.getByLabel("בחירת קובץ CSV").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByText("זוהו 4 מתוך 4 עמודות")).toBeVisible();
  await page.getByRole("button", { name: "ייבוא 4 אנשי קשר" }).click();
  await expect(page.getByText("נוספו 3 · דולגו (כפולים) 0 · לא תקינים 1")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "סגירה" }).last().click();
  await expect(page.getByText("3 אנשי קשר").first()).toBeVisible();

  // Open the contact that has an e-mail; it should see its phone-duplicate
  await page.goto("/he/crm?q=dana");
  await page.getByRole("link", { name: /דנה כהן/ }).first().click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  const keepUrl = page.url();

  // Tags
  await page.getByRole("button", { name: "תגיות" }).click();
  await page.getByLabel("הוספה").fill("VIP, חם");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("VIP", { exact: true })).toBeVisible();
  await expect(page.getByText("חם", { exact: true })).toBeVisible();

  // Merge duplicate
  await expect(page.getByText("כפילויות אפשריות (1)")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "איחוד לכאן" }).click();
  await expect(page.getByText("כפילויות אפשריות")).toHaveCount(0);
  expect(page.url()).toBe(keepUrl);
  await page.goto("/he/crm");
  await expect(page.getByText("2 אנשי קשר").first()).toBeVisible();
  await shot(page, "w1-03-crm-after-import");
});
