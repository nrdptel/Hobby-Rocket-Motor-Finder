import { expect, test, type Page } from "@playwright/test";

// Compare tray: pick 2–4 motors from the catalog, then a shareable /compare view
// overlays their thrust curves and lines up the specs side by side.

async function pickForCompare(page: Page, n: number, query = "in_stock=1") {
  await page.goto(`/?${query}`);
  await expect(page.locator('a[href^="/motor/"]').first()).toBeVisible();
  // The homepage is statically rendered (cacheable), so a shared filtered link
  // applies its filter client-side just after hydration. Wait for that — the
  // reactive "clear all" affordance appears once a filter is active — so we pick
  // from the filtered (in-stock) catalog, not the momentary full one.
  await expect(page.getByRole("button", { name: /clear all/i })).toBeVisible();
  // Clicking the first "Add … to comparison" selects that motor (its button flips
  // to "Remove …"), so the next .first() is the next un-selected motor → n distinct.
  for (let i = 0; i < n; i++) {
    await page.getByRole("button", { name: /Add .* to comparison/ }).first().click();
  }
}

test("selecting motors fills the tray and opens a side-by-side compare", async ({ page }) => {
  await pickForCompare(page, 2);

  // The floating tray reflects the selection count.
  await expect(page.getByText("Compare (2/4)")).toBeVisible();

  // Open the compare view from the tray.
  await page.getByRole("link", { name: /Compare 2 motors/ }).click();
  await expect(page).toHaveURL(/\/compare\/\d+,\d+/);

  await expect(page.getByRole("heading", { name: "Compare motors" })).toBeVisible();
  // The spec table is present (one row per dimension) …
  await expect(page.getByText("Total impulse")).toBeVisible();
  await expect(page.getByText("Cheapest in stock")).toBeVisible();
  // … with a column per compared motor (designation links to the detail page).
  const colLinks = page.locator("table thead a[href^='/motor/']");
  await expect(colLinks).toHaveCount(2);
});

test("the compare set is capped at four", async ({ page }) => {
  await pickForCompare(page, 4);
  await expect(page.getByText("Compare (4/4)")).toBeVisible();
  // A fifth motor's Compare button is disabled (can't exceed the cap).
  const fifth = page.getByRole("button", { name: /Add .* to comparison/ }).first();
  await expect(fifth).toBeDisabled();
});

test("a shared compare link renders without any local selection", async ({ page }) => {
  // First discover two real motor ids by selecting them, then hit the URL fresh
  // in a context whose localStorage is irrelevant to the server-rendered page.
  await pickForCompare(page, 2);
  await page.getByRole("link", { name: /Compare 2 motors/ }).click();
  await expect(page).toHaveURL(/\/compare\/\d+,\d+/);
  const ids = page.url().match(/\/compare\/([\d,]+)/)![1];
  expect(ids).toMatch(/^\d+,\d+$/);

  await page.goto(`/compare/${ids}`);
  await expect(page.getByRole("heading", { name: "Compare motors" })).toBeVisible();
  await expect(page.locator("table thead a[href^='/motor/']")).toHaveCount(2);
});

test("a legacy ?ids= link redirects to the new /compare/<ids> path", async ({ page }) => {
  await pickForCompare(page, 2);
  await page.getByRole("link", { name: /Compare 2 motors/ }).click();
  // Wait for the client navigation to settle before reading the URL — otherwise
  // page.url() can still be the homepage and the match below is null.
  await expect(page).toHaveURL(/\/compare\/\d+,\d+/);
  const ids = page.url().match(/\/compare\/([\d,]+)/)![1];

  await page.goto(`/compare?ids=${ids}`);
  await expect(page).toHaveURL(new RegExp(`/compare/${ids}$`));
  await expect(page.getByRole("heading", { name: "Compare motors" })).toBeVisible();
  await expect(page.locator("table thead a[href^='/motor/']")).toHaveCount(2);
});

test("too few ids shows the pick-motors prompt", async ({ page }) => {
  await page.goto("/compare/999999999");
  await expect(page.getByText(/Pick 2.*motors to compare/)).toBeVisible();
});
