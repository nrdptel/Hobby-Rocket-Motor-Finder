import { defineConfig, devices } from "@playwright/test";

// Headless browser (Chromium) end-to-end tests. These cover the interactive
// behavior the node/vitest unit tests can't — instant client-side filtering, URL
// sync, Back/clear, SSR deep-links, and a clean hydration (no console errors).
// Run against a production build: `npm run build` first, then `npm run test:e2e`.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
