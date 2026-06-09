import { expect, test } from "@playwright/test";

// Motor-character features derived from the ThrustCurve catalog: a sparky filter
// (metal-additive propellants), a burn-character filter, and a specific-impulse
// figure. These views are server-rendered from the URL. The filtering logic
// itself is covered by unit tests; here we confirm the end-to-end wiring — the
// URL drives the pill state, sparky shows as a badge, and burn character +
// specific impulse render as plain text on the rows. (The catalog renders a
// desktop table + mobile cards, CSS-toggled, so things appear twice — hence
// `.first()`.)

test("the sparky filter reflects the URL and renders the sparky badge", async ({ page }) => {
  await page.goto("/?sparky=1");
  await expect(page.getByRole("button", { name: "Sparky" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The lowercase badge text distinguishes it from the "Sparky" filter pill.
  await expect(page.getByText("sparky", { exact: true }).first()).toBeVisible();
});

test("the burn-character filter narrows, and burn character + Isp show as plain text", async ({
  page,
}) => {
  await page.goto("/?burn=long");
  await expect(page.getByRole("button", { name: "Long burn" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Burn character is plain text on the rows now (not a tag), tagged with a title.
  await expect(page.getByTitle(/Burn character/).first()).toBeVisible();
  // Specific impulse is shown on motor rows.
  await expect(
    page.getByTitle(/Specific impulse — propellant efficiency/).first(),
  ).toBeVisible();
});
