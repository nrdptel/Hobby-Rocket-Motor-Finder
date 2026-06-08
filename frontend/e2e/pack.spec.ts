import { expect, test } from "@playwright/test";

// Pack-aware pricing on the detail page: a multipack listing shows the per-motor
// price with a "N-pack · $X total" note (not the pack total as a single price).
// D13W is reliably listed as a 3-pack by several vendors (the listing exists in
// or out of stock, so the note renders regardless).

test("the catalog table shows a multipack's per-unit price with a pack note", async ({ page }) => {
  await page.goto("/?q=D13W"); // D13W is listed as a 3-pack by several vendors
  await expect(page.locator('a[href^="/motor/"]').first()).toBeVisible();
  await expect(page.getByText(/\d+-pack · \$\d/).first()).toBeVisible();
});

test("a multipack listing shows a per-unit price with a pack note", async ({ page }) => {
  await page.goto("/motor/aerotech/D13W");
  await expect(page.getByRole("heading", { name: "Availability by vendor" })).toBeVisible();

  // At least one "N-pack · $X total" annotation appears in the vendor table.
  await expect(page.getByText(/\d+-pack · \$\d/).first()).toBeVisible();
});

// A 29mm rocket's loadout surfaces mid-power motors, some sold only in packs —
// each must show the "· N-pack" hint next to its per-unit price (so "$16.50"
// isn't mistaken for a single when the minimum buy is a 2-pack).
test("the rocket loadout pairs a multipack's per-unit price with a pack hint", async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      "hpr.rockets.v1",
      JSON.stringify([
        {
          id: "r1",
          name: "29mm",
          diameterMm: 29,
          cert: null,
          impulseClass: null,
          caseInfo: null,
          minImpulseNs: null,
          maxImpulseNs: null,
        },
      ]),
    ),
  );
  await page.goto("/?dia=29&in_stock=1");
  const loadout = page.locator("section", { hasText: "Fly it:" }).first();
  await expect(loadout.getByText(/· \d+-pack/).first()).toBeVisible();
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
