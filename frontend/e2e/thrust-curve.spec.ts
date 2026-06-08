import { expect, test } from "@playwright/test";

// A motor's detail page renders its measured thrust curve (a server-rendered
// SVG) from the curves.json sidecar. We open the first motor from the catalog
// rather than hard-coding a designation, since the served snapshot's contents
// shift hourly.

test("a motor detail page renders its thrust curve chart", async ({ page }) => {
  await page.goto("/");
  // Resolve the first motor's detail URL and navigate to it (reading the href
  // sidesteps table-vs-card visibility quirks of clicking).
  const href = await page.locator('a[href^="/motor/"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href as string);

  // The chart is an SVG with role="img" labelled "Thrust curve for <designation>".
  await expect(page.getByRole("img", { name: /Thrust curve for/ }).first()).toBeVisible();
  // And the section heading is present.
  await expect(page.getByRole("heading", { name: /Thrust curve/ })).toBeVisible();
});

test("the catalog rows show thrust-curve sparklines", async ({ page }) => {
  await page.goto("/");
  // Each motor with a curve gets a small sparkline glyph in its row.
  await expect(page.getByRole("img", { name: "thrust curve shape" }).first()).toBeVisible();
});
