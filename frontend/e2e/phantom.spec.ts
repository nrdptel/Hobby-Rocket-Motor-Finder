import { expect, test } from "@playwright/test";

// "Phantom" motors: real catalog motors (AeroTech/Cesaroni/Loki, D+) that no
// tracked vendor stocks. A search for one must land on an honest page, not an
// empty result. F21W is an out-of-production AeroTech motor (it won't be
// restocked, so it stays a phantom).

test("a phantom motor's detail page is honest and offers a buyable swap", async ({ page }) => {
  await page.goto("/motor/aerotech/F21W");
  await expect(page.getByRole("heading", { name: "F21W" })).toBeVisible();
  await expect(page.getByText("Not sold by any tracked vendor").first()).toBeVisible();
  // The closest in-stock alternative is offered.
  await expect(page.getByRole("heading", { name: /Similar motors/ })).toBeVisible();
  await expect(page.locator('a[href^="/motor/"]').first()).toBeVisible();
});

test("searching the catalog finds a phantom and marks it unsold", async ({ page }) => {
  await page.goto("/?q=F21W");
  await expect(page.locator('a[href$="/F21W"]').first()).toBeVisible();
  await expect(page.getByText(/Not sold by any tracked vendor/).first()).toBeVisible();
});
