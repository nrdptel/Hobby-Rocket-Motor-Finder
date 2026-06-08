import { expect, test } from "@playwright/test";

// Motor-character features derived from the ThrustCurve catalog: a sparky filter
// (metal-additive propellants), a burn-character filter/badge, and a specific-
// impulse figure. These views are server-rendered from the URL. The filtering
// logic itself is covered by unit tests; here we confirm the end-to-end wiring —
// the URL drives the pill state and the badges/figure render on the results.
// (The catalog renders a desktop table + mobile cards, CSS-toggled, so badges
// appear twice in the DOM — hence `.first()`.)

test("the sparky filter reflects the URL and renders the sparky badge", async ({ page }) => {
  await page.goto("/?sparky=1");
  await expect(page.getByRole("button", { name: "✨ Sparky" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The lowercase badge text distinguishes it from the "✨ Sparky" filter pill.
  await expect(page.getByText("✨ sparky", { exact: true }).first()).toBeVisible();
});

test("the burn-character filter renders its badge, and specific impulse shows", async ({ page }) => {
  await page.goto("/?burn=long");
  await expect(page.getByRole("button", { name: "Long burn" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The "long burn" badge — identified by its unique title so we don't match the
  // filter pill (whose title differs).
  await expect(page.getByTitle(/lofting push/).first()).toBeVisible();
  // Specific impulse is shown on motor rows.
  await expect(
    page.getByTitle(/Specific impulse — propellant efficiency/).first(),
  ).toBeVisible();
});
