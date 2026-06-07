import { expect, test } from "@playwright/test";

// The catalog's instant client-side filtering: a filter change must update the
// results WITHOUT a server round-trip (no full navigation/reload), keep the URL
// in sync, and SSR a shared filtered link correctly.

const motorLinks = (page: import("@playwright/test").Page) =>
  page.locator('a[href^="/motor/"]');

// A window flag survives in-page (client) re-renders but is wiped by a full
// document navigation/reload — so it proves filtering didn't hit the server.
const setSentinel = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
const sentinelSurvived = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);

test("toggling a filter updates results instantly with no page reload", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await motorLinks(page).count();
  expect(before).toBeGreaterThan(0);

  await setSentinel(page);
  await page.getByRole("button", { name: "In stock only" }).click();

  // URL synced via pushState…
  await expect(page).toHaveURL(/in_stock=1/);
  // …with NO full navigation (the sentinel is still there)…
  expect(await sentinelSurvived(page)).toBe(true);
  // …and the results re-filtered client-side.
  await expect.poll(() => motorLinks(page).count()).toBeLessThan(before);
  await expect(page.getByRole("button", { name: "In stock only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Back undoes a filter and Clear all resets", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await motorLinks(page).count();

  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).toHaveURL(/in_stock=1/);

  await page.goBack();
  await expect(page).not.toHaveURL(/in_stock/);
  await expect.poll(() => motorLinks(page).count()).toBe(before);

  await page.getByRole("button", { name: "In stock only" }).click();
  await expect(page).toHaveURL(/in_stock=1/);
  await page.getByRole("button", { name: "clear all" }).click();
  await expect(page).not.toHaveURL(/in_stock/);
  await expect.poll(() => motorLinks(page).count()).toBe(before);
});

test("search narrows the catalog client-side (debounced)", async ({ page }) => {
  await page.goto("/");
  await expect(motorLinks(page).first()).toBeVisible();
  const before = await motorLinks(page).count();

  await setSentinel(page);
  await page.getByPlaceholder(/designation or vendor SKU/i).fill("J90");

  await expect(page).toHaveURL(/q=J90/); // after the debounce
  expect(await sentinelSurvived(page)).toBe(true);
  await expect.poll(() => motorLinks(page).count()).toBeLessThan(before);
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
