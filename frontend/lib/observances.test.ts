import { describe, expect, it } from "vitest";
import { observancesForDate } from "./observances";

// A date in the given month (UTC noon to avoid TZ edge cases), 0-indexed month.
const inMonth = (m: number) => new Date(Date.UTC(2026, m, 15, 12));

describe("observancesForDate", () => {
  it("populates every month of the year", () => {
    for (let m = 0; m < 12; m++) {
      expect(observancesForDate(inMonth(m)).length, `month ${m}`).toBeGreaterThan(0);
    }
  });

  it("every observance is well-formed (message, emoji, https link, accent bar)", () => {
    const ids: string[] = [];
    for (let m = 0; m < 12; m++) {
      for (const o of observancesForDate(inMonth(m))) {
        ids.push(o.id);
        expect(o.emoji, o.id).toBeTruthy();
        expect(o.message, o.id).toBeTruthy();
        expect(o.href, o.id).toMatch(/^https:\/\//);
        expect(o.hrefLabel, o.id).toBeTruthy();
        expect(o.bar?.background, o.id).toBeTruthy();
        expect(o.bar?.title, o.id).toBeTruthy();
      }
    }
    // ids are unique across the year.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("June honors both Pride and Men's Mental Health, in that order", () => {
    expect(observancesForDate(inMonth(5)).map((o) => o.id)).toEqual([
      "pride",
      "mens-mental-health",
    ]);
  });
});
