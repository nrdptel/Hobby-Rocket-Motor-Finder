import { expect, test, type Page } from "@playwright/test";

// The compacted filter panel: secondary filters (vendor/case/propellant/
// character/impulse/price) hide behind a "More filters" disclosure, and the
// price filter + price sort behave as documented.

const motorLinks = (page: Page) => page.locator('a[href^="/motor/"]');

async function matchCount(page: Page): Promise<number> {
  const text = await page.getByText(/with stock somewhere/).textContent();
  return parseInt(text!.match(/(\d+)/)![1], 10);
}

test("secondary filters hide behind a 'More filters' disclosure", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  // Collapsed by default — the price input isn't even rendered.
  await expect(page.getByLabel(/Maximum price in dollars/)).toHaveCount(0);
  await page.getByRole("button", { name: /More filters/ }).click();
  await expect(page.getByLabel(/Maximum price in dollars/)).toBeVisible();
});

test("a shared link with a price filter auto-opens the disclosure", async ({ page }) => {
  await page.goto("/?pmax=25");
  await expect(motorLinks(page).first()).toBeVisible();
  // The homepage is static, so the URL's price bound applies client-side just
  // after hydration; the disclosure then auto-opens (an applied filter is never
  // hidden) with the value reflected.
  await expect(page.getByLabel(/Maximum price in dollars/)).toBeVisible();
  await expect(page.getByLabel(/Maximum price in dollars/)).toHaveValue("25");
});

test("the price filter narrows the catalog client-side", async ({ page }) => {
  await page.goto("/?in_stock=1");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await matchCount(page);

  await page.getByRole("button", { name: /More filters/ }).click();
  await page.getByLabel(/Maximum price in dollars/).fill("20");
  await expect(page).toHaveURL(/pmax=20/); // after the debounce
  await expect.poll(() => matchCount(page)).toBeLessThan(before);
});

test("sorting by Price is stock-agnostic and shows the clarifying hint", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await matchCount(page);

  // The full catalog is heavy, so the <select>'s onChange can be unwired when we
  // first drive it (a bare selectOption then fires before hydration and is lost,
  // and `networkidle` doesn't mean "hydrated"). Retry the change until it sticks
  // — i.e. until the onChange has written the URL — which is robust regardless of
  // hydration timing.
  await expect(async () => {
    await page.locator("#sort-order").selectOption("price");
    await expect(page).toHaveURL(/order=price/, { timeout: 1000 });
  }).toPass();
  // The hint tells users it ranks across ALL vendors (pair with in-stock).
  await expect(page.getByText(/cheapest across all vendors/)).toBeVisible();
  // Sorting reorders but doesn't filter — the match count is unchanged.
  await expect.poll(() => matchCount(page)).toBe(before);
});
