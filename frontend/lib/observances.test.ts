import { describe, expect, it } from "vitest";
import { observancesForDate } from "./observances";

describe("observancesForDate", () => {
  it("returns Pride and Men's Mental Health for June", () => {
    const june = observancesForDate(new Date("2026-06-13T12:00:00Z"));
    expect(june.map((o) => o.id)).toEqual(["pride", "mens-mental-health"]);
    // Each June observance has a top accent bar and a support link.
    for (const o of june) {
      expect(o.bar?.background).toBeTruthy();
      expect(o.bar?.title).toBeTruthy();
      expect(o.href).toMatch(/^https:\/\//);
      expect(o.hrefLabel).toBeTruthy();
      expect(o.message).toBeTruthy();
      expect(o.emoji).toBeTruthy();
    }
  });

  it("returns nothing for a month with no observance", () => {
    expect(observancesForDate(new Date("2026-02-15T12:00:00Z"))).toEqual([]);
  });
});
