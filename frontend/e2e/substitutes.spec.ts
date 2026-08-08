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

// Wait until the catalog is hydrated and React owns the page. The static export
// ships the first batch of ~50 motors, and the window auto-grows past that only
// once client JS is running — so more cards than the SSR batch proves hydration.
// Tests that merely click something must gate on this: <details> opens natively
// with no JS, so a pre-hydration click toggles the disclosure without React ever
// hearing the toggle event, and nothing gets recorded.
async function waitForHydration(page: Page) {
  await expect.poll(() => resultsCards(page).count(), { timeout: 30_000 }).toBeGreaterThan(60);
}

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

  // waitForURL, not an expect() on page.url(): this is a client-side route
  // transition, and the App Router only writes the URL once the destination has
  // rendered. That takes ~300ms unloaded but scales with CPU pressure, so an
  // assertion timeout (5s) is the wrong budget for it — a navigation one is.
  await page.waitForURL((u) => u.pathname === href);
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

// Coming Back from a swap must land you on the list you left, still open. The
// catalog remounts on Back (that's why it restores scroll), and <details> open
// state is DOM state React doesn't otherwise re-apply — so without persistence
// the shopper who followed swap 1 has to re-find and re-open the disclosure to
// look at swap 2.
async function expectSwapListSurvivesBack(page: Page, scope: Locator, hidden: Locator) {
  await expect(scope.first()).toBeVisible();
  await expect(hidden.first()).toBeHidden();
  // Recording the toggle needs React attached — see waitForHydration.
  await waitForHydration(page);

  const details = await firstSwapDisclosure(page, scope);
  await details.locator("summary").click();

  const swap = details.locator('a[href^="/motor/"]').first();
  const href = (await swap.getAttribute("href"))!;
  await expect(swap).toBeVisible();
  await swap.click();
  await page.waitForURL((u) => u.pathname === href);

  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/");

  // Open means readable: a collapsed <details> hides its body, so asserting the
  // swap we followed is visible inside the same disclosure is both the
  // user-facing claim and a sturdier check than the open attribute. Scoped to
  // that one disclosure — a popular swap is suggested under several motors.
  const back = await firstSwapDisclosure(page, scope);
  await expect(back.locator(`a[href="${href}"]`)).toBeVisible({ timeout: 15_000 });
}

test("the swap list is still open after coming Back from a swap", async ({ page }) => {
  test.setTimeout(90_000); // waits out a full hydrate, a route change, and a Back
  await page.goto("/");
  await expectSwapListSurvivesBack(page, resultsTable(page), resultsCards(page));
});

test("the swap list survives Back in the mobile card list too", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectSwapListSurvivesBack(page, resultsCards(page), resultsTable(page));
});

// A filter change resets the render window to its first batch, unmounting and
// remounting every row past it. A disclosure the viewer opened in THIS session
// (never persisted through a navigation) has to survive that too — otherwise it
// collapses under them, the same way a Back used to.
test("an open swap list survives the remount a filter change causes", async ({ page }) => {
  // Drives a full hydrate plus two complete re-filters, each re-rendering the
  // whole catalog — more wall-clock than the 30s default allows under load.
  test.setTimeout(90_000);
  await page.goto("/");
  await waitForHydration(page);

  const details = await firstSwapDisclosure(page, resultsTable(page));
  await details.locator("summary").click();
  const href = (await details.locator('a[href^="/motor/"]').first().getAttribute("href"))!;
  await expect(details.locator(`a[href="${href}"]`)).toBeVisible();

  // Any filter change resets the window (and re-renders the whole list).
  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).toHaveURL(/in_stock=1/);
  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).not.toHaveURL(/in_stock/);

  const after = await firstSwapDisclosure(page, resultsTable(page));
  await expect(after.locator(`a[href="${href}"]`)).toBeVisible({ timeout: 15_000 });
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
