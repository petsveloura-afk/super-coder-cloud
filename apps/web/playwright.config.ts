import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running app + Supabase (local `supabase start` recommended).
 *   E2E_BASE_URL       default http://localhost:3000
 *   PW_CHROMIUM_PATH   optional custom Chromium binary (CI images without Playwright browsers)
 *   PW_CHROMIUM_ARGS   optional space-separated launch args for that binary
 * Supabase Auth must have email auto-confirm enabled for the signup journey
 * (supabase/config.toml sets enable_confirmations = false for local dev).
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const args = process.env.PW_CHROMIUM_ARGS ? process.env.PW_CHROMIUM_ARGS.split(" ").filter(Boolean) : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: undefined }, testIgnore: /mobile\.spec\.ts/ },
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium", channel: undefined }, testMatch: /mobile\.spec\.ts/ },
  ],
});
