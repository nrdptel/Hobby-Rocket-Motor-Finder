import { expect, test, type Locator, type Page } from "@playwright/test";

// The catalog's "N similar motors in stock" disclosure — shown under a motor
// that's sold out everywhere. Each swap's designation links to that motor's own
// detail page, the same affordance the detail page's "Similar motors in stock"
// list has, so a shopper can vet a suggestion (specs, curve, every vendor)
// before following the vendor link off-site.
//
// The catalog renders BOTH layouts into the same DOM — the desktop table
// (`hidden md:block`) and the mobile card list (`md:hidden`) — each with its own
// copy of the disclosure. So each case scopes to its layout's container by
// structure and asserts the other layout is really hidden: picking "the first
// visible details" instead would let a breakpoint regression quietly turn these
// into two copies of the same test.

// The results table, not the "Unmatched listings" table further down the page.
const resultsTable = (page: Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Variety" }) });

// MotorCard is the only <article> on the catalog page.
const resultsCards = (page: Page) => page.locator("article");

// The first swap disclosure inside `scope`. Matching on the SUMMARY's text (not
// the whole <details>) keeps this off the Methodology panel, which also contains
// the phrase "Similar motors in stock" — in its body, as a <dt>. The results
// window auto-fills the whole catalog, so the first sold-out motor with swaps
// can take a beat to render.
async function firstSwapDisclosure(page: Page, scope: Locator) {
  const details = scope
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /similar motors? in stock/i }) })
    .first();
  await expect(details).toBeVisible({ timeout: 15_000 });
  return details;
}

async function expectSwapOpensItsDetailPage(page: Page, scope: Locator, hidden: Locator) {
  await expect(scope.first()).toBeVisible();
  await expect(hidden.first()).toBeHidden(); // we're really on the layout we think we are

  const details = await firstSwapDisclosure(page, scope);
  await details.locator("summary").click();

  // The designation link, not the vendor's "at <vendor> →" (which is external).
  const swap = details.locator('a[href^="/motor/"]').first();
  await expect(swap).toBeVisible();
  const href = (await swap.getAttribute("href"))!;
  const designation = (await swap.locator("span").first().textContent())!.trim();
  expect(designation).not.toBe("");

  await swap.click();

  await expect.poll(() => new URL(page.url()).pathname).toBe(href);
  // The real check that the link points at the RIGHT motor: the page it lands on
  // is titled with the designation we clicked.
  await expect(page.getByRole("heading", { level: 1, name: designation })).toBeVisible();
}

test("a swap in the catalog's similar-motors list opens its detail page", async ({ page }) => {
  await page.goto("/");
  await expectSwapOpensItsDetailPage(page, resultsTable(page), resultsCards(page));
});

test("the same swap link works in the mobile card list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectSwapOpensItsDetailPage(page, resultsCards(page), resultsTable(page));
});

// The designation must look like a link at rest, not only on hover: there is no
// hover on a touch screen, and it sits inline with same-weight text, so a
// hover-only underline leaves it reading as plain text.
test("a swap designation is underlined at rest, not just on hover", async ({ page }) => {
  await page.goto("/");
  const details = await firstSwapDisclosure(page, resultsTable(page));
  await details.locator("summary").click();

  const designation = details.locator('a[href^="/motor/"] span').first();
  await expect(designation).toBeVisible();
  await expect(designation).toHaveCSS("text-decoration-line", "underline");
});
