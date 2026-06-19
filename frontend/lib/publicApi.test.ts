// Guards the public /api/v1 contract. The generator's pure transform lives in
// scripts/gen-api.mjs (single source for both the build output and this test);
// allowJs in tsconfig lets us import it here.
import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs build script, no type declarations.
import { SCHEMA_VERSION, buildApi, toPublicMotor } from "../scripts/gen-api.mjs";

const snapshot = {
  generated_at: "2026-06-19T00:00:00.000Z",
  motors: [
    {
      id: 1,
      manufacturer: "AeroTech",
      designation: "H128W",
      common_name: "H128",
      diameter_mm: 29,
      impulse_class: "H",
      total_impulse_ns: 176.2,
      avg_thrust_n: 128,
      burn_time_s: 1.4,
      propellant: "White Lightning",
      delays: "6,10,14",
      delay_adjustable: true,
      sparky: false,
      motor_type: "reload",
      case_info: "RMS-29/180",
      listings: [
        {
          vendor_slug: "csrocketry",
          vendor_name: "Chris' Rocket Supplies",
          url: "https://csrocketry.com/h128w",
          sku: "1",
          raw_designation: "H128W",
          price_cents: 3499,
          currency: "USD",
          status: "in_stock",
          stock_count: null,
          seen_at: "2026-06-19T00:00:00.000Z",
        },
        {
          // A cheaper-looking 2-pack: per-unit price should win the "cheapest".
          vendor_slug: "wildman",
          vendor_name: "Wildman",
          url: "https://wildmanrocketry.com/h128w-2-pack",
          sku: "2",
          raw_designation: "H128W",
          price_cents: 6000,
          currency: "USD",
          status: "in_stock_with_count",
          stock_count: 4,
          pack_size: 2,
          seen_at: "2026-06-19T00:00:00.000Z",
        },
        {
          vendor_slug: "sirius",
          vendor_name: "Sirius Rocketry",
          url: "https://siriusrocketry.biz/h128w",
          sku: "3",
          raw_designation: "H128W",
          price_cents: 3300,
          currency: "USD",
          status: "out_of_stock",
          stock_count: null,
          seen_at: "2026-06-19T00:00:00.000Z",
        },
      ],
    },
    {
      id: 2,
      manufacturer: "Cesaroni Technology",
      designation: "J360",
      diameter_mm: 38,
      impulse_class: "J",
      total_impulse_ns: 720,
      avg_thrust_n: 360,
      burn_time_s: 2,
      propellant: null,
      delays: null,
      delay_adjustable: false,
      listings: [
        {
          vendor_slug: "performancehobbies",
          vendor_name: "Performance Hobbies",
          url: "https://performancehobbies.com/j360",
          sku: null,
          raw_designation: "J360",
          price_cents: 8999,
          currency: "USD",
          status: "out_of_stock",
          stock_count: null,
          seen_at: "2026-06-19T00:00:00.000Z",
        },
      ],
    },
    // No listings — must be excluded from the API entirely.
    {
      id: 3,
      manufacturer: "AeroTech",
      designation: "K1100T",
      diameter_mm: 54,
      impulse_class: "K",
      total_impulse_ns: 2500,
      avg_thrust_n: 1100,
      burn_time_s: 2.3,
      propellant: "Blue Thunder",
      delays: null,
      delay_adjustable: false,
      listings: [],
    },
  ],
  unmatched: [],
};

describe("buildApi", () => {
  const api = buildApi(snapshot);

  it("stamps schema version + generated_at on every payload", () => {
    for (const p of [api.meta, api.motors, api.inStock, api.vendors]) {
      expect(p.schema_version).toBe(SCHEMA_VERSION);
      expect(p.generated_at).toBe("2026-06-19T00:00:00.000Z");
    }
  });

  it("excludes motors with no listings", () => {
    const ids = api.motors.motors.map((m: { id: number }) => m.id);
    expect(ids).toEqual([1, 2]); // id 3 (K1100T, no listings) dropped
    expect(api.meta.counts.motors).toBe(2);
  });

  it("computes motor-level in-stock + vendor counts", () => {
    const h = api.motors.motors.find((m: { id: number }) => m.id === 1);
    expect(h.in_stock).toBe(true);
    expect(h.vendor_count).toBe(3);
    expect(h.in_stock_vendor_count).toBe(2);
    const j = api.motors.motors.find((m: { id: number }) => m.id === 2);
    expect(j.in_stock).toBe(false);
  });

  it("picks the pack-aware cheapest in-stock listing (per-unit, not sticker)", () => {
    const h = api.motors.motors.find((m: { id: number }) => m.id === 1);
    // Wildman 2-pack at $60 → $30/unit beats csrocketry's $34.99 single.
    expect(h.cheapest_in_stock.vendor_slug).toBe("wildman");
    expect(h.cheapest_in_stock.unit_price_cents).toBe(3000);
    expect(h.cheapest_in_stock.pack_size).toBe(2);
  });

  it("collapses in_stock_with_count → in_stock with a stock_count", () => {
    const h = api.motors.motors.find((m: { id: number }) => m.id === 1);
    const wm = h.listings.find((l: { vendor_slug: string }) => l.vendor_slug === "wildman");
    expect(wm.status).toBe("in_stock");
    expect(wm.stock_count).toBe(4);
    expect(wm.unit_price_cents).toBe(3000);
  });

  it("in-stock endpoint contains only motors in stock somewhere", () => {
    expect(api.inStock.motors.map((m: { id: number }) => m.id)).toEqual([1]);
    expect(api.inStock.count).toBe(1);
  });

  it("builds per-vendor counts", () => {
    const slugs = api.vendors.vendors.map((v: { slug: string }) => v.slug).sort();
    expect(slugs).toEqual(["csrocketry", "performancehobbies", "sirius", "wildman"]);
    const cs = api.vendors.vendors.find((v: { slug: string }) => v.slug === "csrocketry");
    expect(cs.motor_count).toBe(1);
    expect(cs.in_stock_count).toBe(1);
    const sr = api.vendors.vendors.find((v: { slug: string }) => v.slug === "sirius");
    expect(sr.in_stock_count).toBe(0); // sirius listing is out of stock
  });

  it("meta lists manufacturers and endpoints", () => {
    expect(api.meta.manufacturers).toEqual(["AeroTech", "Cesaroni Technology"]);
    expect(api.meta.endpoints.motors).toBe("/api/v1/motors.json");
  });

  it("toPublicMotor omits internal-only fields (sku, raw_designation)", () => {
    const pub = toPublicMotor(snapshot.motors[0]);
    const listingKeys = Object.keys(pub.listings[0]);
    expect(listingKeys).not.toContain("sku");
    expect(listingKeys).not.toContain("raw_designation");
    expect(listingKeys).toContain("unit_price_cents");
  });
});
