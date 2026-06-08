import { expect, test } from "@playwright/test";

// Pack-aware pricing on the detail page: a multipack listing shows the per-motor
// price with a "N-pack · $X total" note (not the pack total as a single price).
// D13W is reliably listed as a 3-pack by several vendors (the listing exists in
// or out of stock, so the note renders regardless).

test("a multipack listing shows a per-unit price with a pack note", async ({ page }) => {
  await page.goto("/motor/aerotech/D13W");
  await expect(page.getByRole("heading", { name: "Availability by vendor" })).toBeVisible();

  // At least one "N-pack · $X total" annotation appears in the vendor table.
  await expect(page.getByText(/\d+-pack · \$\d/).first()).toBeVisible();
});

// E26W is sold only as a 2-pack (Wildman) — a stable multipack-only motor. The
// planner must price it per-unit but bill the whole pack, and say so.
test("the planner prices a multipack per-unit but bills the whole pack", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("hpr.watchlist", "[11]"));
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
  // The plan line shows the per-unit price + the pack…
  await expect(page.getByText(/\/ea · \d+× \d+-pack/).first()).toBeVisible();
  // …and is honest about the over-buy (want 1, get 2 from a 2-pack).
  await expect(page.getByText(/→ \d+ motors/).first()).toBeVisible();
});
