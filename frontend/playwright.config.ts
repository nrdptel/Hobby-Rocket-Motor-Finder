import { defineConfig, devices } from "@playwright/test";

// Headless browser (Chromium) end-to-end tests. These cover the interactive
// behavior the node/vitest unit tests can't — instant client-side filtering, URL
// sync, Back/clear, deep-links, and a clean hydration (no console errors).
//
// Run against the STATIC EXPORT: `npm run build` first (emits out/), then
// `npm run test:e2e`. The webServer serves out/ with `serve` instead of
// `next start` (which doesn't work with output: export), using e2e-serve.json to
// emulate the Cloudflare _redirects rewrite (one compare shell for any
// /compare/<ids>) and the _headers security headers.

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
    // Serve the static export (out/) on :3000 with the Cloudflare-emulating
    // config (e2e-serve.json). `--no-clipboard` keeps `serve` non-interactive.
    command: "npx serve -c e2e-serve.json -l 3000 --no-clipboard --no-request-logging",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
