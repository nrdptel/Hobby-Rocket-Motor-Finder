import { describe, expect, it } from "vitest";

import { buildRocketLoadout } from "./loadout";
import type { RocketSpec } from "./rocketFit";
import type { Listing, Motor } from "./snapshot";

let nextId = 1;
function listing(over: Partial<Listing> = {}): Listing {
  return {
    vendor_slug: "v",
    vendor_name: "Vendor",
    url: `https://v/${nextId}`,
    sku: null,
    raw_designation: "",
    price_cents: 1000,
    currency: "USD",
    status: "in_stock",
    stock_count: null,
    seen_at: "2026-06-07T00:00:00Z",
    ...over,
  };
}
function motor(over: Partial<Motor> = {}): Motor {
  return {
    id: nextId++,
    manufacturer: "AeroTech",
    designation: "H100W",
    diameter_mm: 38,
    impulse_class: "H",
    total_impulse_ns: 200,
    avg_thrust_n: 100,
    burn_time_s: 2,
    propellant: null,
    delays: null,
    delay_adjustable: false,
    listings: [listing()],
    ...over,
  };
}

const rocket = (over: Partial<RocketSpec> = {}): RocketSpec => ({
  diameterMm: 38,
  cert: null,
  impulseClass: null,
  caseInfo: null,
  minImpulseNs: null,
  maxImpulseNs: null,
  ...over,
});

describe("buildRocketLoadout", () => {
  it("lists in-stock fitting motors cheapest first", () => {
    const a = motor({ diameter_mm: 38, listings: [listing({ price_cents: 3000 })] });
    const b = motor({ diameter_mm: 38, listings: [listing({ price_cents: 1500 })] });
    const c = motor({ diameter_mm: 54, listings: [listing({ price_cents: 1000 })] }); // wrong mount
    const lo = buildRocketLoadout(rocket(), [a, b, c]);
    expect(lo.inStock.map((e) => e.motor.id)).toEqual([b.id, a.id]);
    expect(lo.totalFit).toBe(2);
  });

  it("counts sold-out fits separately and excludes them from inStock", () => {
    const inStk = motor({ diameter_mm: 38, listings: [listing({ status: "in_stock" })] });
    const sold = motor({ diameter_mm: 38, listings: [listing({ status: "out_of_stock" })] });
    const lo = buildRocketLoadout(rocket(), [inStk, sold]);
    expect(lo.inStock.map((e) => e.motor.id)).toEqual([inStk.id]);
    expect(lo.totalFit).toBe(2);
    expect(lo.soldOutFit).toBe(1);
  });

  it("respects the rocket's impulse band for exact fits", () => {
    const inBand = motor({ diameter_mm: 38, total_impulse_ns: 250 });
    const tooBig = motor({ diameter_mm: 38, total_impulse_ns: 900 });
    const lo = buildRocketLoadout(rocket({ minImpulseNs: 100, maxImpulseNs: 400 }), [inBand, tooBig]);
    expect(lo.inStock.map((e) => e.motor.id)).toEqual([inBand.id]);
    expect(lo.totalFit).toBe(1);
  });

  it("surfaces in-stock SWAPS only when nothing that fits is buyable", () => {
    // The in-band motor is sold out; an out-of-band same-mount motor is in stock.
    const wantSold = motor({ diameter_mm: 38, total_impulse_ns: 250, listings: [listing({ status: "out_of_stock" })] });
    const swap = motor({ diameter_mm: 38, total_impulse_ns: 600, listings: [listing({ status: "in_stock" })] });
    const lo = buildRocketLoadout(rocket({ minImpulseNs: 100, maxImpulseNs: 400 }), [wantSold, swap]);
    expect(lo.inStock).toHaveLength(0);
    expect(lo.soldOutFit).toBe(1);
    expect(lo.swaps.map((e) => e.motor.id)).toEqual([swap.id]);
    expect(lo.swaps[0].fitsExactly).toBe(false);
  });

  it("ranks swaps by nearest impulse to the rocket's target", () => {
    const near = motor({ diameter_mm: 38, total_impulse_ns: 500 });
    const far = motor({ diameter_mm: 38, total_impulse_ns: 2000 });
    // Target band 100–400 (midpoint 250); nothing in-band, both swaps in stock.
    const lo = buildRocketLoadout(rocket({ minImpulseNs: 100, maxImpulseNs: 400 }), [near, far]);
    expect(lo.swaps.map((e) => e.motor.id)).toEqual([near.id, far.id]);
  });

  it("does not show swaps when an exact fit is in stock", () => {
    const inBand = motor({ diameter_mm: 38, total_impulse_ns: 250, listings: [listing({ status: "in_stock" })] });
    const other = motor({ diameter_mm: 38, total_impulse_ns: 900, listings: [listing({ status: "in_stock" })] });
    const lo = buildRocketLoadout(rocket({ minImpulseNs: 100, maxImpulseNs: 400 }), [inBand, other]);
    expect(lo.inStock).toHaveLength(1);
    expect(lo.swaps).toHaveLength(0);
  });

  it("a diameter-only rocket with nothing in stock has no swaps (relaxed == exact)", () => {
    const sold = motor({ diameter_mm: 38, listings: [listing({ status: "out_of_stock" })] });
    const lo = buildRocketLoadout(rocket(), [sold]);
    expect(lo.inStock).toHaveLength(0);
    expect(lo.swaps).toHaveLength(0);
  });
});
