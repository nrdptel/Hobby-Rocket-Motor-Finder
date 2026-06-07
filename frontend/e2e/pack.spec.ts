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
