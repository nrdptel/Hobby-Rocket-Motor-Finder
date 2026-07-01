import { describe, expect, it } from "vitest";

import { bestSingleVendor, buildOrderPlan, buildSwapSuggestions, vendorOffers } from "./plan";
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
      {
        vendorSlug: "v1",
        vendorName: "V1",
        unitPriceCents: 4500,
        packSizeUnits: 1,
        packsToBuy: 1,
        lineCostCents: 4500,
        url: "https://x/p",
      },
    ]);
  });

  it("excludes a vendor whose reported count is below the wanted quantity", () => {
    const m = M(8, "Y", [L("v1", "V1", 1000, "in_stock_with_count", 2), L("v2", "V2", 1500)]);
    expect(vendorOffers({ motor: m, qty: 5 }).map((o) => o.vendorSlug)).toEqual(["v2"]);
    // qty within count → v1 allowed (and cheaper)
    expect(vendorOffers({ motor: m, qty: 2 }).map((o) => o.vendorSlug).sort()).toEqual(["v1", "v2"]);
  });
});

describe("pack-aware planning", () => {
  // A motor sold as a 3-pack ($21 = $7/ea) at v1, and as a single ($12) at v2.
  function packMotor(id: number, des: string): Motor {
    const m = M(id, des, [
      { ...L("v1", "V1", 2100), url: "https://v/d13-3-pack" }, // $7/ea as a 3-pack
      { ...L("v2", "V2", 1200), url: "https://v/d13-single" }, // $12 single
    ]);
    return m;
  }

  it("offers per-unit price but charges whole packs (ceil(qty/N) × pack price)", () => {
    const m = packMotor(20, "D13W");
    // qty 1: buy one 3-pack = $21 (cheaper actual cost than the $12 single? no —
    // $21 > $12, so the single wins for qty 1).
    const [o1] = vendorOffers({ motor: m, qty: 1 }).filter((o) => o.vendorSlug === "v1");
    expect(o1).toMatchObject({ unitPriceCents: 700, packSizeUnits: 3, packsToBuy: 1, lineCostCents: 2100 });
    // qty 3: the 3-pack ($21) beats 3× single ($36).
    const o3 = vendorOffers({ motor: m, qty: 3 }).find((o) => o.vendorSlug === "v1")!;
    expect(o3.lineCostCents).toBe(2100);
  });

  it("the planner buys the cheapest ACTUAL cost, pack-aware", () => {
    const m = packMotor(21, "D13W");
    // Want 3: cheapest is the v1 3-pack at $21 (vs 3× $12 single = $36 at v2).
    const plan = buildOrderPlan([{ motor: m, qty: 3 }], 0);
    expect(plan.totalCents).toBe(2100);
    const line = plan.assignments[0].lines[0];
    expect(line).toMatchObject({ packSizeUnits: 3, packsToBuy: 1, lineCostCents: 2100 });
  });

  it("rounds up to whole packs when qty isn't a multiple", () => {
    // Only a 3-pack available; want 4 → buy 2 packs = $42.
    const m = M(22, "E", [{ ...L("v1", "V1", 2100), url: "https://v/e-3-pack" }]);
    const plan = buildOrderPlan([{ motor: m, qty: 4 }], 0);
    expect(plan.assignments[0].lines[0]).toMatchObject({ packsToBuy: 2, lineCostCents: 4200 });
  });

  it("ignores a non-positive ($0) price — never wins the plan as 'free'", () => {
    const m = M(24, "E", [L("v1", "V1", 0, "in_stock"), L("v2", "V2", 1500, "in_stock")]);
    expect(vendorOffers({ motor: m, qty: 1 }).map((o) => o.vendorSlug)).toEqual(["v2"]);
  });

  it("checks stock_count against PACKS needed, not motors wanted", () => {
    // A 2-pack with only 1 pack in stock covers 2 motors, but not 4.
    const m = M(23, "E", [{ ...L("v1", "V1", 2000, "in_stock_with_count", 1), url: "https://v/e-2-pack" }]);
    expect(vendorOffers({ motor: m, qty: 2 }).map((o) => o.vendorSlug)).toEqual(["v1"]); // 1 pack = 2 motors
    expect(vendorOffers({ motor: m, qty: 4 })).toEqual([]); // needs 2 packs, only 1 in stock
  });
});

describe("buildSwapSuggestions", () => {
  // All M() motors are 54mm/J/2000 N·s/90 N → substitutes of each other.
  const soldOut = M(10, "SOLD", [L("v1", "V1", 5000, "out_of_stock")]);
  const swapA = M(11, "SWAPA", [L("v1", "V1", 4000)]);
  const swapB = M(12, "SWAPB", [L("v2", "V2", 4200)]);
  const wrongDia: Motor = { ...M(13, "WRONG", [L("v1", "V1", 3000)]), diameter_mm: 38 };

  it("offers in-stock substitutes for a sold-out motor", () => {
    const res = buildSwapSuggestions([soldOut], [soldOut, swapA, swapB, wrongDia], new Set());
    expect(res).toHaveLength(1);
    expect(res[0].soldOut.id).toBe(10);
    expect(res[0].swaps.map((s) => s.id).sort()).toEqual([11, 12]); // wrong diameter excluded
  });

  it("excludes swaps already on the order", () => {
    const res = buildSwapSuggestions([soldOut], [soldOut, swapA, swapB], new Set([11]));
    expect(res[0].swaps.map((s) => s.id)).toEqual([12]);
  });

  it("keeps a sold-out motor with no swaps (so a restock alert can still show)", () => {
    const noData: Motor = { ...soldOut, total_impulse_ns: null }; // can't justify a swap
    const res = buildSwapSuggestions([noData], [noData, swapA], new Set());
    expect(res).toHaveLength(1);
    expect(res[0].swaps).toHaveLength(0);
  });

  it("respects the per-motor limit", () => {
    const extra = [14, 15, 16].map((i) => M(i, `S${i}`, [L("v1", "V1", 4100 + i)]));
    const res = buildSwapSuggestions([soldOut], [soldOut, swapA, swapB, ...extra], new Set(), 2);
    expect(res[0].swaps).toHaveLength(2);
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

  it("returns a coherent empty plan when nothing is coverable — no phantom shipping", () => {
    // Star only motors that are sold out everywhere, then open the planner.
    const oosA = M(7, "G", [L("v1", "V1", 1000, "out_of_stock")]);
    const oosB = M(8, "H", [L("v2", "V2", 2000, "out_of_stock")]);
    // Non-zero shipping must NOT leak into the total when there are zero orders.
    const plan = buildOrderPlan([{ motor: oosA, qty: 1 }, { motor: oosB, qty: 2 }], 5000);
    expect(plan.assignments).toEqual([]);
    expect(plan.ordersCount).toBe(0);
    expect(plan.motorCostCents).toBe(0);
    expect(plan.shippingCents).toBe(0);
    expect(plan.totalCents).toBe(0);
    expect(plan.unavailable.map((m) => m.id).sort()).toEqual([7, 8]);
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
