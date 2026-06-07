import { describe, expect, it } from "vitest";

import { bestSingleVendor, buildOrderPlan, vendorOffers } from "./plan";
import type { Listing, Motor } from "./snapshot";

function L(
  slug: string,
  name: string,
  price: number | null,
  status: Listing["status"] = "in_stock",
  count: number | null = null,
): Listing {
  return {
    vendor_slug: slug,
    vendor_name: name,
    url: "https://x/p",
    sku: null,
    raw_designation: "x",
    price_cents: price,
    currency: "USD",
    status,
    stock_count: count,
    seen_at: "2026-06-06T12:00:00+00:00",
  };
}

function M(id: number, designation: string, listings: Listing[]): Motor {
  return {
    id,
    manufacturer: "AeroTech",
    designation,
    diameter_mm: 54,
    impulse_class: "J",
    total_impulse_ns: 2000,
    avg_thrust_n: 90,
    burn_time_s: 5,
    propellant: "White Lightning",
    delays: "6",
    delay_adjustable: true,
    listings,
  };
}

// A is at V1 ($50) and V2 ($40); B is at V1 ($30) and V3 ($20).
const A = M(1, "A", [L("v1", "V1", 5000), L("v2", "V2", 4000)]);
const B = M(2, "B", [L("v1", "V1", 3000), L("v3", "V3", 2000)]);

describe("vendorOffers", () => {
  it("takes the cheapest in-stock price per vendor, dropping OOS / no-price", () => {
    const m = M(9, "Z", [
      L("v1", "V1", 5000),
      L("v1", "V1", 4500), // cheaper same vendor → wins
      L("v2", "V2", 3000, "out_of_stock"), // OOS → dropped
      L("v3", "V3", null), // no price → dropped
    ]);
    expect(vendorOffers({ motor: m, qty: 1 })).toEqual([
      { vendorSlug: "v1", vendorName: "V1", unitPriceCents: 4500, url: "https://x/p" },
    ]);
  });

  it("excludes a vendor whose reported count is below the wanted quantity", () => {
    const m = M(8, "Y", [L("v1", "V1", 1000, "in_stock_with_count", 2), L("v2", "V2", 1500)]);
    expect(vendorOffers({ motor: m, qty: 5 }).map((o) => o.vendorSlug)).toEqual(["v2"]);
    // qty within count → v1 allowed (and cheaper)
    expect(vendorOffers({ motor: m, qty: 2 }).map((o) => o.vendorSlug).sort()).toEqual(["v1", "v2"]);
  });
});

describe("buildOrderPlan — cheapest total = motor cost + shipping × orders", () => {
  it("zero shipping → split to the cheapest per-motor vendor", () => {
    const plan = buildOrderPlan([{ motor: A, qty: 1 }, { motor: B, qty: 1 }], 0);
    expect(plan.motorCostCents).toBe(4000 + 2000); // A@V2 + B@V3
    expect(plan.ordersCount).toBe(2);
    expect(plan.totalCents).toBe(6000);
    expect(plan.unavailable).toEqual([]);
  });

  it("high shipping → consolidate to one vendor even at a higher motor price", () => {
    const plan = buildOrderPlan([{ motor: A, qty: 1 }, { motor: B, qty: 1 }], 5000);
    // V1 has both: $50 + $30 = $80 motors + 1×$50 ship = $130 — beats the $60+$100 split.
    expect(plan.ordersCount).toBe(1);
    expect(plan.assignments[0].vendorSlug).toBe("v1");
    expect(plan.assignments[0].lines).toHaveLength(2);
    expect(plan.totalCents).toBe(8000 + 5000);
  });

  it("multiplies cost by quantity", () => {
    const plan = buildOrderPlan([{ motor: A, qty: 3 }], 0);
    expect(plan.motorCostCents).toBe(4000 * 3); // A@V2 × 3
  });

  it("plans what it can and flags motors out of stock everywhere", () => {
    const oos = M(4, "D", [L("v1", "V1", 1000, "out_of_stock")]);
    const plan = buildOrderPlan([{ motor: A, qty: 1 }, { motor: oos, qty: 1 }], 0);
    expect(plan.unavailable.map((m) => m.id)).toEqual([4]);
    expect(plan.assignments.some((a) => a.lines.some((l) => l.motor.id === 1))).toBe(true);
  });
});

describe("bestSingleVendor", () => {
  it("picks the vendor that covers the most wanted motors", () => {
    const best = bestSingleVendor([{ motor: A, qty: 1 }, { motor: B, qty: 1 }]);
    expect(best?.vendorSlug).toBe("v1"); // V1 stocks both
    expect(best?.covers).toBe(2);
    expect(best?.coverable).toBe(2);
    expect(best?.missing).toEqual([]);
  });

  it("breaks coverage ties by cheaper cost and reports what's missing", () => {
    const C = M(5, "E", [L("v2", "V2", 1000)]); // only V2
    // V1 covers {A,B} for $80; V2 covers {A,C} for $50 → tie on 2 covered, V2 cheaper.
    const best = bestSingleVendor([{ motor: A, qty: 1 }, { motor: B, qty: 1 }, { motor: C, qty: 1 }]);
    expect(best?.vendorSlug).toBe("v2");
    expect(best?.covers).toBe(2);
    expect(best?.coverable).toBe(3);
    expect(best?.missing.map((m) => m.id)).toEqual([2]); // B
  });

  it("returns null when nothing is in stock anywhere", () => {
    const oos = M(6, "F", [L("v1", "V1", 1000, "out_of_stock")]);
    expect(bestSingleVendor([{ motor: oos, qty: 1 }])).toBeNull();
  });
});
