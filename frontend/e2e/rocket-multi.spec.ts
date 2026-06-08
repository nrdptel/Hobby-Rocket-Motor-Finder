import { expect, test } from "@playwright/test";

// "My rockets" lets a rocket pin SEVERAL impulse classes and/or reload cases
// (e.g. every case it can fly), not just one. Adding a rocket with two classes
// via the multi-select should filter the catalog to a comma-list and summarize
// the rocket as "X/Y-class". The class control is the only "Any class" trigger
// on the page (the catalog's own class filter is a pill row), so it's
// unambiguous.

test("a rocket can pin multiple impulse classes via the multi-select", async ({ page }) => {
  await page.goto("/");

  // Wait for hydration before interacting — this prompt only renders client-side
  // (hydrated && no saved rockets), so its presence means handlers are attached.
  await expect(page.getByText("Save your rocket to filter by what fits it")).toBeVisible();

  await page.getByRole("button", { name: "+ Add rocket" }).click();

  // Open the Class multi-select and tick the first two classes.
  await page.getByRole("button", { name: "Any class" }).click();
  const panel = page.getByRole("group", { name: "class filter" });
  const boxes = panel.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  // The trigger reflects the two-class selection.
  await expect(page.getByRole("button", { name: "2 classes" })).toBeVisible();

  await page.getByRole("button", { name: "Add & show" }).click();

  // The catalog is now filtered by two comma-separated classes...
  await expect
    .poll(() => new URL(page.url()).searchParams.get("class"))
    .toMatch(/^[A-O],[A-O]$/);

  // ...and the saved rocket chip (the 🚀-prefixed one, vs. its edit/delete
  // siblings) summarizes them as "X/Y-class".
  await expect(page.getByRole("button", { name: /🚀.*[A-O]\/[A-O]-class/ })).toBeVisible();
});
