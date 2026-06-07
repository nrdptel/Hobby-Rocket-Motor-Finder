import { expect, test, type Page } from "@playwright/test";

// The catalog's instant client-side filtering: a filter change must update the
// results WITHOUT a server round-trip (no full navigation/reload), keep the URL
// in sync, and SSR a shared filtered link correctly. Plus windowed rendering:
// only a slice of the (up to ~600) results is in the DOM at once.

const motorLinks = (page: Page) => page.locator('a[href^="/motor/"]');

// The "N motors · M with stock somewhere" summary reflects the full filtered
// match count (independent of how many rows are windowed into the DOM).
async function matchCount(page: Page): Promise<number> {
  const text = await page.getByText(/with stock somewhere/).textContent();
  return parseInt(text!.match(/(\d+)/)![1], 10);
}

// A window flag survives in-page (client) re-renders but is wiped by a full
// document navigation/reload — so it proves filtering didn't hit the server.
const setSentinel = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
const sentinelSurvived = (page: Page) =>
  page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);

test("toggling a filter updates results instantly with no page reload", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await matchCount(page);
  expect(before).toBeGreaterThan(0);

  await setSentinel(page);
  await page.getByRole("button", { name: "In stock only" }).click();

  // URL synced via pushState…
  await expect(page).toHaveURL(/in_stock=1/);
  // …with NO full navigation (the sentinel is still there)…
  expect(await sentinelSurvived(page)).toBe(true);
  // …and the match count dropped, client-side.
  await expect.poll(() => matchCount(page)).toBeLessThan(before);
  await expect(page.getByRole("button", { name: "In stock only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Back undoes a filter and Clear all resets", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await matchCount(page);

  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).toHaveURL(/in_stock=1/);

  await page.goBack();
  await expect(page).not.toHaveURL(/in_stock/);
  await expect.poll(() => matchCount(page)).toBe(before);

  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).toHaveURL(/in_stock=1/);
  await page.getByRole("button", { name: "clear all" }).click();
  await expect(page).not.toHaveURL(/in_stock/);
  await expect.poll(() => matchCount(page)).toBe(before);
});

test("search narrows the catalog client-side (debounced)", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await matchCount(page);

  await setSentinel(page);
  await page.getByPlaceholder(/designation or vendor SKU/i).fill("J90");

  await expect(page).toHaveURL(/q=J90/); // after the debounce
  expect(await sentinelSurvived(page)).toBe(true);
  await expect.poll(() => matchCount(page)).toBeLessThan(before);
});

test("a shared filtered link is server-rendered directly", async ({ page }) => {
  await page.goto("/?in_stock=1");
  await expect(motorLinks(page).first()).toBeVisible();
  // The toggle reflects the URL on first paint (SSR), no flash needed.
  await expect(page.getByRole("button", { name: "In stock only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("results are windowed: a subset renders with a Show more control", async ({ page }) => {
  await page.goto("/"); // the full catalog (hundreds of motors)
  await expect(motorLinks(page).first()).toBeVisible();
  const total = await matchCount(page);
  expect(total).toBeGreaterThan(100); // enough to exceed the window

  // Far fewer rows are in the DOM than the full catalog (windowed). Each motor
  // renders a desktop + a mobile link, so DOM links ≈ 2× the window, still well
  // under 2× the full set.
  const initialRendered = await motorLinks(page).count();
  expect(initialRendered).toBeLessThan(total); // not everything is rendered

  // The Show more fallback grows the window.
  const showMore = page.getByRole("button", { name: /Show \d+ more/ });
  await expect(showMore).toBeVisible();
  await showMore.click();
  await expect.poll(() => motorLinks(page).count()).toBeGreaterThan(initialRendered);
});

test("loads with no console or page errors (clean hydration)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
