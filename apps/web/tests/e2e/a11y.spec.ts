import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createOrg, signUp, uniqueEmail } from "./helpers";

/** Fails on serious/critical WCAG 2.1 A/AA violations. */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = blocking.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes.slice(0, 12).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`,
  );
  expect(summary, `${label}\n${summary.join("\n")}`).toEqual([]);
}

test("accessibility: auth pages in all locales", async ({ page }) => {
  for (const l of ["he", "ar", "en"]) {
    await page.goto(`/${l}/login`);
    await audit(page, `login ${l}`);
    await page.goto(`/${l}/signup`);
    await audit(page, `signup ${l}`);
  }
});

test("accessibility: core app screens (dark and light)", async ({ page }) => {
  test.setTimeout(240_000); // 8 full axe audits + sign-up + demo data
  await signUp(page, { name: "Axe Tester", email: uniqueEmail("axe") });
  await audit(page, "onboarding");
  await createOrg(page, "Axe Org", `axe-${Date.now()}`);
  await page.getByRole("button", { name: "טעינת נתוני דמו" }).click();
  await expect(page.getByText(/סביבת דמו/)).toBeVisible();
  for (const theme of ["dark", "light"]) {
    await page.context().addCookies([{ name: "scc_theme", value: theme, url: page.url() }]);
    for (const path of ["/he/overview", "/he/crm", "/he/team", "/he/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await audit(page, `${path} (${theme})`);
    }
  }
});
