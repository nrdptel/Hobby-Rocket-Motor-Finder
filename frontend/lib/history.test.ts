import { describe, expect, it } from "vitest";

import {
  HISTORY_EPOCH,
  buildMotorAvailability,
  catalogAvailability,
  formatAgo,
  formatWindow,
  isInStock,
  type HistoryLog,
} from "./history";

// A fixed "now" two full days past the epoch, so the window is always
// "meaningful" unless a test overrides it.
const NOW = "2026-06-07T18:00:00Z";
const EPOCH = HISTORY_EPOCH; // 2026-06-05T18:00:00Z

const hours = (h: number) => h * 3_600_000;

// Helper to build a single-listing log + the matching snapshot listing.
function oneVendor(events: HistoryLog[string]["events"]) {
  const url = "https://v/p";
  const log: HistoryLog = { [url]: { vendor_slug: "v", events } };
  const listings = [{ url, vendor_name: "Vendor V", vendor_slug: "v" }];
  return { log, listings };
}

describe("isInStock", () => {
  it("treats both in-stock enum values as in stock, nothing else", () => {
    expect(isInStock("in_stock")).toBe(true);
    expect(isInStock("in_stock_with_count")).toBe(true);
    expect(isInStock("out_of_stock")).toBe(false);
    expect(isInStock("special_order")).toBe(false);
    expect(isInStock(null)).toBe(false);
    expect(isInStock(undefined)).toBe(false);
  });
});

describe("buildMotorAvailability", () => {
  it("returns null when the motor has no history at all", () => {
    expect(buildMotorAvailability([{ url: "https://v/p", vendor_name: "V", vendor_slug: "v" }], {}, NOW)).toBeNull();
  });

  it("a listing in stock for the whole window is 100% buyable", () => {
    const { log, listings } = oneVendor([{ t: EPOCH, status: "in_stock", price_cents: 1000 }]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.fraction).toBeCloseTo(1, 5);
    expect(a.currentlyInStock).toBe(true);
    expect(a.lastBuyableAtMs).toBe(Date.parse(NOW));
    expect(a.windowMs).toBe(hours(48));
  });

  it("computes a partial fraction when stock came back midway", () => {
    // out for the first day, in for the second → ~50% buyable.
    const { log, listings } = oneVendor([
      { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
      { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.fraction).toBeCloseTo(0.5, 2);
    expect(a.currentlyInStock).toBe(true);
  });

  it("clips the window to the epoch — pre-epoch in-stock time is NOT counted", () => {
    // In stock since well before the epoch, then goes out at the epoch and stays
    // out. Buyable time inside the window is ~0 despite a long pre-epoch run.
    const { log, listings } = oneVendor([
      { t: "2026-05-30T00:00:00Z", status: "in_stock", price_cents: 1000 },
      { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.fraction).toBeCloseTo(0, 5);
    expect(a.trackStartMs).toBe(Date.parse(EPOCH));
    expect(a.windowMs).toBe(hours(48));
  });

  it("honours the state carried into the epoch from a pre-epoch event", () => {
    // Last pre-epoch event is in_stock and nothing changes → buyable the whole
    // window even though the event predates the epoch.
    const { log, listings } = oneVendor([
      { t: "2026-05-30T00:00:00Z", status: "in_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.fraction).toBeCloseTo(1, 5);
  });

  it("unions in-stock time across vendors (buyable = in stock SOMEWHERE)", () => {
    // Vendor A in stock first half, vendor B in stock second half → together the
    // motor was buyable the whole window.
    const urlA = "https://a/p";
    const urlB = "https://b/p";
    const log: HistoryLog = {
      [urlA]: {
        vendor_slug: "a",
        events: [
          { t: EPOCH, status: "in_stock", price_cents: 1000 },
          { t: "2026-06-06T18:00:00Z", status: "out_of_stock", price_cents: 1000 },
        ],
      },
      [urlB]: {
        vendor_slug: "b",
        events: [
          { t: EPOCH, status: "out_of_stock", price_cents: 1200 },
          { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1200 },
        ],
      },
    };
    const listings = [
      { url: urlA, vendor_name: "A", vendor_slug: "a" },
      { url: urlB, vendor_name: "B", vendor_slug: "b" },
    ];
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.fraction).toBeCloseTo(1, 2);
    expect(a.vendors).toHaveLength(2);
  });

  it("tracks price low/high within the window only", () => {
    const { log, listings } = oneVendor([
      { t: "2026-05-30T00:00:00Z", status: "in_stock", price_cents: 500 }, // pre-epoch, ignored
      { t: EPOCH, status: "in_stock", price_cents: 1000 },
      { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1500 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.priceLowCents).toBe(1000);
    expect(a.priceHighCents).toBe(1500);
  });

  it("flags a sub-12h window as not meaningful", () => {
    const justAfter = "2026-06-05T22:00:00Z"; // 4h after epoch
    const { log, listings } = oneVendor([{ t: EPOCH, status: "in_stock", price_cents: 1000 }]);
    const a = buildMotorAvailability(listings, log, justAfter)!;
    expect(a.meaningful).toBe(false);
    expect(a.windowMs).toBe(hours(4));
  });

  it("per-vendor segments span the axis and sum to ~1", () => {
    const { log, listings } = oneVendor([
      { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
      { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    const v = a.vendors[0];
    const total = v.segments.reduce((s, seg) => s + seg.widthFrac, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(v.segments.map((s) => s.kind)).toEqual(["out", "in"]);
    expect(v.currentlyInStock).toBe(true);
  });

  it("marks a late-joining vendor's pre-first-event stretch as unknown", () => {
    // Vendor A sets trackStart at the epoch; vendor B's first event is a day in,
    // so B's timeline opens with an unknown stretch (we never saw it before).
    const urlA = "https://a/p";
    const urlB = "https://b/p";
    const log: HistoryLog = {
      [urlA]: { vendor_slug: "a", events: [{ t: EPOCH, status: "out_of_stock", price_cents: 1000 }] },
      [urlB]: {
        vendor_slug: "b",
        events: [{ t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1200 }],
      },
    };
    const listings = [
      { url: urlA, vendor_name: "A", vendor_slug: "a" },
      { url: urlB, vendor_name: "B", vendor_slug: "b" },
    ];
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.trackStartMs).toBe(Date.parse(EPOCH));
    const b = a.vendors.find((v) => v.vendorSlug === "b")!;
    expect(b.segments[0].kind).toBe("unknown");
    expect(b.segments.map((s) => s.kind)).toContain("in");
  });

  it("builds a motor-level union timeline of in/out segments summing to ~1", () => {
    const { log, listings } = oneVendor([
      { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
      { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.timeline.map((s) => s.kind)).toEqual(["out", "in"]);
    expect(a.timeline.reduce((s, seg) => s + seg.widthFrac, 0)).toBeCloseTo(1, 5);
    // No "unknown" at the motor level — it's a pure in/out union.
    expect(a.timeline.every((s) => s.kind !== "unknown")).toBe(true);
  });

  it("reports last-buyable when currently out of stock", () => {
    const { log, listings } = oneVendor([
      { t: EPOCH, status: "in_stock", price_cents: 1000 },
      { t: "2026-06-06T18:00:00Z", status: "out_of_stock", price_cents: 1000 },
    ]);
    const a = buildMotorAvailability(listings, log, NOW)!;
    expect(a.currentlyInStock).toBe(false);
    expect(a.lastBuyableAtMs).toBe(Date.parse("2026-06-06T18:00:00Z"));
  });
});

describe("catalogAvailability", () => {
  it("keys a compact summary by motor id and matches the full builder's fraction", () => {
    const url = "https://v/p";
    const log: HistoryLog = {
      [url]: {
        vendor_slug: "v",
        events: [
          { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
          { t: "2026-06-06T18:00:00Z", status: "in_stock", price_cents: 1000 },
        ],
      },
    };
    const listings = [{ url, vendor_name: "V", vendor_slug: "v" }];
    const motors = [{ id: 42, listings: [{ url }] }];

    const cat = catalogAvailability(motors, log, NOW);
    const full = buildMotorAvailability(listings, log, NOW)!;

    expect(cat[42].fraction).toBeCloseTo(full.fraction, 6);
    expect(cat[42].currentlyInStock).toBe(full.currentlyInStock);
    expect(cat[42].meaningful).toBe(true);
  });

  it("omits motors with no history", () => {
    const motors = [{ id: 1, listings: [{ url: "https://nope/p" }] }];
    expect(catalogAvailability(motors, {}, NOW)).toEqual({});
  });

  it("flags a currently-in-stock-but-mostly-out motor as low fraction", () => {
    // Out for ~75% of the window, in only the last quarter, in stock now.
    const url = "https://v/p";
    const log: HistoryLog = {
      [url]: {
        vendor_slug: "v",
        events: [
          { t: EPOCH, status: "out_of_stock", price_cents: 1000 },
          { t: "2026-06-07T06:00:00Z", status: "in_stock", price_cents: 1000 },
        ],
      },
    };
    const cat = catalogAvailability([{ id: 7, listings: [{ url }] }], log, NOW);
    expect(cat[7].currentlyInStock).toBe(true);
    expect(cat[7].fraction).toBeLessThan(0.4);
  });
});

describe("format helpers", () => {
  it("formatWindow pluralises hours and days", () => {
    expect(formatWindow(hours(1))).toBe("1 hour");
    expect(formatWindow(hours(5))).toBe("5 hours");
    expect(formatWindow(hours(72))).toBe("3 days");
    expect(formatWindow(0)).toBe("1 hour");
  });

  it("formatAgo is compact h/d with a 1h floor", () => {
    expect(formatAgo(hours(3))).toBe("3h");
    expect(formatAgo(hours(48))).toBe("2d");
    expect(formatAgo(60_000)).toBe("1h");
  });
});
