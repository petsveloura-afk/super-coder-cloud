import { expect, test } from "@playwright/test";
import { createOrg, shot, signUp, uniqueEmail } from "./helpers";

/**
 * Google Gemini as the AI provider (free tier). Runs only when the server was
 * started with GEMINI_API_KEY and without Anthropic/OpenAI (E2E_AI_PROVIDER=gemini).
 */
const geminiOnly = process.env.E2E_AI_PROVIDER === "gemini";

test("AI with Google Gemini: agent chat, contact summary, credits metered", async ({ page }) => {
  test.skip(!geminiOnly, "server not started in Gemini-only mode");
  test.setTimeout(120_000);
  await signUp(page, { name: "Gemini Owner", email: uniqueEmail("gemini") });
  await createOrg(page, "Gemini Co", `gemini-${Date.now()}`);
  await page.goto("/he/ai-agents");
  await expect(page.getByText(/AI עדיין לא הוגדר/)).toHaveCount(0);
  await page.getByRole("button", { name: "סוכן חדש" }).first().click();
  const d = page.getByRole("dialog");
  await d.locator("#agent-name").fill("סוכן Gemini");
  await expect(d.locator("#agent-provider")).toHaveValue("gemini"); // the only configured provider is pre-selected
  await expect(d.locator("#agent-model")).toHaveValue(/^gemini-/);
  await d.locator('button[type="submit"]').click();
  await expect(page.getByText("סוכן Gemini").first()).toBeVisible();

  await page.getByPlaceholder("כתבו הודעה לסוכן…").fill("שלום, מה שעות הפעילות?");
  await page.getByRole("button", { name: "שליחה" }).click();
  await expect(page.getByText(/MOCK-GEMINI ✓ \(gemini-/).first()).toBeVisible();
  await shot(page, "g1-gemini-agent");

  await page.goto("/he/crm?new=1");
  const c = page.getByRole("dialog");
  await c.locator("#firstName").fill("נועם");
  await c.locator("#email").fill(uniqueEmail("noam"));
  await c.locator('button[type="submit"]').click();
  await page.waitForURL(/\/he\/crm\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "סיכום AI" }).click();
  await expect(page.getByText(/MOCK-GEMINI ✓.*data-block-ok/)).toBeVisible();

  await page.goto("/he/billing");
  // 2 calls × ceil(1100 tokens / 1000) = 4 credits of 50
  await expect(page.getByText("4 / 50")).toBeVisible();
});
