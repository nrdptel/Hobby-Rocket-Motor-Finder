import { expect, test } from "@playwright/test";

// The rocket loadout ("what can I fly in my rocket right now"): when a saved
// rocket is the active filter, a panel lists the in-stock motors that fit and
// can add them all to a Plan order in one tap. Rockets live in localStorage, so
// we seed one before load rather than clicking through the add form.

const ROCKET = JSON.stringify([
  {
    id: "r1",
    name: "Test 38",
    diameterMm: 38,
    cert: "l1",
    impulseClass: null,
    caseInfo: null,
    minImpulseNs: null,
    maxImpulseNs: null,
  },
]);

test("an active rocket shows its loadout and 'add all' loads the order", async ({ page }) => {
  await page.addInitScript((r) => window.localStorage.setItem("hpr.rockets.v1", r), ROCKET);
  await page.goto("/?dia=38&cert=l1");

  // The loadout appears (after hydration reads the saved rocket).
  await expect(page.getByRole("heading", { name: /Fly it:/ })).toBeVisible();

  const addAll = page.getByRole("button", { name: /Add all \d+ to order/ });
  await expect(addAll).toBeVisible();
  const n = parseInt((await addAll.textContent())!.match(/(\d+)/)![1], 10);
  expect(n).toBeGreaterThan(0);

  await addAll.click();

  // It flips to a "plan your order" link, and the header cart reflects the count.
  await expect(page.getByText(/Added — plan your order/)).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Plan order \\(${n}\\)`) })).toBeVisible();
});
