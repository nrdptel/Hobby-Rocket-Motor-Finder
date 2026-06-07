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
