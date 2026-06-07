import { expect, test } from "@playwright/test";

// Plan order's swap-fill: when starred motors are sold out everywhere, the
// planner offers in-stock substitutes to keep the order buyable, and "+ add"
// drops one into the order. These ids are motors that are sold out at every
// tracked vendor but DO have in-stock same-mount/class substitutes (stable
// catalog primary keys; the shortage keeps them sold out). Seeding several makes
// the test resilient to any single one restocking.
const SOLD_OUT_IDS = [364, 366, 368, 370, 371, 374, 375, 376];

test("sold-out motors offer in-stock swaps that add to the order", async ({ page }) => {
  await page.addInitScript(
    (ids) => window.localStorage.setItem("hpr.watchlist", JSON.stringify(ids)),
    SOLD_OUT_IDS,
  );
  await page.goto("/plan");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "Not in stock anywhere" }),
  });
  await expect(section).toBeVisible();

  const addBtn = section.getByRole("button", { name: /Add .* to your order/ }).first();
  await expect(addBtn).toBeVisible();
  const swapName = (await addBtn.getAttribute("aria-label"))!.match(/Add (\S+) to your order/)![1];

  await addBtn.click();

  // The swap now appears in "Your list" (it was starred → joined the order).
  const list = page.locator("section", {
    has: page.getByRole("heading", { name: /Your list/ }),
  });
  await expect(list.getByText(swapName, { exact: true }).first()).toBeVisible();
});
