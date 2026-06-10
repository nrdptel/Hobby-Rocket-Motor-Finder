import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated WCAG 2.0/2.1 A + AA audit of the key pages, in both light and dark
// themes. Discovery mode: logs every violation with impact, page, theme, and a
// sample node so concrete issues can be fixed. (Tightened to assert-zero once
// the findings are addressed.)

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PAGES: [string, string][] = [
  // Catalog scoped to one class: axe over the full ~600-row list is too slow to
  // be a reliable CI check, and a single class still exercises every element
  // type (header rows, listings, status badges, prices, cert pills, substitutes).
  ["catalog", "/?class=H"],
  ["detail", "/motor/aerotech/D10W"],
  ["plan", "/plan"],
  ["compare", "/compare?ids=1,2,3,4"],
  ["privacy", "/privacy"],
  ["alerts", "/alerts"],
];

for (const [name, path] of PAGES) {
  for (const scheme of ["light", "dark"] as const) {
    test(`a11y: ${name} (${scheme})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      // Expand the My Rockets add-form so its fields are audited too — otherwise
      // it's collapsed and never scanned.
      if (name === "catalog") {
        await page.getByRole("button", { name: /Add rocket/ }).click();
        await page.waitForTimeout(150);
      }
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const v of violations) {
        const node = v.nodes[0];
        console.log(
          `\n[${v.impact}] ${name}/${scheme} :: ${v.id} — ${v.help}` +
            `\n  nodes: ${v.nodes.length} | ${(node?.target || []).join(" ")}` +
            `\n  html: ${(node?.html || "").slice(0, 140)}` +
            `\n  fix: ${(node?.failureSummary || "").replace(/\n/g, " ")}`,
        );
      }
      expect(violations.map((v) => v.id)).toEqual([]);
    });
  }
}
