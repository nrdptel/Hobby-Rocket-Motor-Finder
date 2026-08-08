import { expect, test, type Page } from "@playwright/test";

// The catalog's "N similar motors in stock" disclosure — shown under a motor
// that's sold out everywhere. Each swap's designation links to that motor's own
// detail page, the same affordance the detail page's "Similar motors in stock"
// list has, so a shopper can vet a suggestion (specs, curve, every vendor)
// before following the vendor link off-site. Covered at both breakpoints: the
// desktop table and the mobile card list render the disclosure independently.

// The first *visible* swap disclosure. The catalog renders the desktop table and
// the mobile card list into the same DOM (one is CSS-hidden per breakpoint), so
// ":visible" picks whichever the current viewport shows. The results window
// auto-fills the whole catalog, so the first sold-out motor with swaps can take
// a beat to render.
async function firstSwapDisclosure(page: Page) {
  const details = page
    .locator("details:visible")
    .filter({ hasText: /similar motors? in stock/ })
    .first();
  await expect(details).toBeVisible({ timeout: 15_000 });
  return details;
}

async function expectSwapOpensItsDetailPage(page: Page) {
  const details = await firstSwapDisclosure(page);
  await details.locator("summary").click();

  // The designation link, not the vendor's "at <vendor> →" (which is external).
  const swap = details.locator('a[href^="/motor/"]').first();
  await expect(swap).toBeVisible();
  const href = (await swap.getAttribute("href"))!;
  const designation = (await swap.locator("span").first().textContent())!.trim();
  expect(designation).not.toBe("");

  await swap.click();

  await expect.poll(() => new URL(page.url()).pathname).toBe(href);
  await expect(page.getByRole("heading", { level: 1, name: designation })).toBeVisible();
}

test("a swap in the catalog's similar-motors list opens its detail page", async ({ page }) => {
  await page.goto("/");
  await expectSwapOpensItsDetailPage(page);
});

test("the same swap link works in the mobile card list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectSwapOpensItsDetailPage(page);
});
