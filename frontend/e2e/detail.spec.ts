import { expect, test } from "@playwright/test";

// The motor detail page's "Availability history" section: how often the motor
// has been buyable since tracking became reliable, plus a per-vendor timeline.
// Navigated from the catalog so the test is robust to which motors the live
// snapshot happens to carry.

test("a motor detail page shows the availability-history section", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('a[href^="/motor/"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);

  const heading = page.getByRole("heading", { name: "Availability history" });
  await expect(heading).toBeVisible();

  // The motor-level "buyable somewhere" union strip is always rendered for a
  // motor with history (it's an aria-labelled img).
  await expect(page.getByRole("img", { name: "In stock at any vendor" })).toBeVisible();

  // With a multi-day clean window the headline is a buyable-% (not the
  // still-building placeholder).
  await expect(page.getByText(/buyable somewhere over the last/)).toBeVisible();
});
