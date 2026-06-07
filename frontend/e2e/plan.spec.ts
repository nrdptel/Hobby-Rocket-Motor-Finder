import { expect, test, type Page } from "@playwright/test";

// "Plan your order": star a few in-stock motors, then the /plan page computes the
// cheapest cross-vendor order. All client-side over the in-memory catalog.

async function starFirstInStock(page: Page, n: number) {
  await page.goto("/?in_stock=1");
  await expect(page.locator('a[href^="/motor/"]').first()).toBeVisible();
  // Clicking the first "Add … to watchlist" stars that motor (its button flips to
  // "Remove"), so the next .first() is the next un-starred motor → n distinct.
  for (let i = 0; i < n; i++) {
    await page.getByRole("button", { name: /Add .* to watchlist/ }).first().click();
  }
}

test("planner builds a cheapest order from starred motors", async ({ page }) => {
  await starFirstInStock(page, 3);

  // The Plan-order entry point appears once you've starred motors.
  await page.getByRole("link", { name: /Plan order/ }).first().click();
  await expect(page).toHaveURL(/\/plan/);

  await expect(page.getByText("Cheapest total")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Your list \(3\)/ })).toBeVisible();
  // The 3 starred motors are in stock → a real total + buy links.
  await expect(page.getByTestId("plan-total")).toContainText("$");
  await expect(page.getByRole("link", { name: "buy →" }).first()).toBeVisible();
});

test("changing quantity updates the total", async ({ page }) => {
  await starFirstInStock(page, 2);
  await page.goto("/plan");
  await expect(page.getByText("Cheapest total")).toBeVisible();

  const total = page.getByTestId("plan-total");
  const before = await total.textContent();
  await page.getByRole("button", { name: /Increase quantity/ }).first().click();
  await expect.poll(async () => (await total.textContent()) !== before).toBe(true);
});

test("the planner persists the list (watchlist) across a reload", async ({ page }) => {
  await starFirstInStock(page, 2);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: /Your list \(2\)/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Your list \(2\)/ })).toBeVisible();
});

test("empty list shows the 'star motors' prompt", async ({ page }) => {
  // Each test gets a fresh, isolated browser context (empty localStorage).
  await page.goto("/plan");
  await expect(page.getByText(/Your list is empty/)).toBeVisible();
});

test("a share link opens the order as a preview for a recipient", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await starFirstInStock(page, 2);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: /Your list \(2\)/ })).toBeVisible();

  await page.getByRole("button", { name: /Copy share link/ }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/plan?order=");

  // A fresh recipient (empty watchlist) opens the link → preview mode.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await expect(p2.getByText(/viewing a/)).toBeVisible(); // "shared order" banner
  await expect(p2.getByRole("heading", { name: /Shared list \(2\)/ })).toBeVisible();

  // Saving it adopts the order into their own watchlist.
  await p2.getByRole("button", { name: "Save to my list" }).click();
  await expect(p2.getByRole("heading", { name: /Your list \(2\)/ })).toBeVisible();
  await ctx2.close();
});

test("copy as text yields a readable order summary", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await starFirstInStock(page, 2);
  await page.goto("/plan");
  await page.getByRole("button", { name: /Copy as text/ }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("HPR motor order");
  expect(text).toContain("Total:");
});
