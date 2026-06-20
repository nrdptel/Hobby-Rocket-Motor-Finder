// Guards the public /api/v1 contract. The generator's pure transform lives in
// scripts/gen-api.mjs (single source for both the build output and this test);
// allowJs in tsconfig lets us import it here.
import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs build script, no type declarations.
import {
  SCHEMA_VERSION,
  buildApi,
  buildOpenApi,
  designationToSlug,
  manufacturerSlug,
  motorApiPath,
  toPublicMotor,
} from "../scripts/gen-api.mjs";

const listing = (over: Record<string, unknown>) => ({
  vendor_slug: "csrocketry",
  vendor_name: "Chris' Rocket Supplies",
  url: "https://csrocketry.com/x",
  sku: "1",
  raw_designation: "H128W",
  price_cents: 3499,
  currency: "USD",
  status: "in_stock",
  stock_count: null,
  seen_at: "2026-06-19T00:00:00.000Z",
  ...over,
});

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
        listing({ vendor_slug: "csrocketry", vendor_name: "Chris' Rocket Supplies", url: "u1", price_cents: 3499 }),
        // SECOND csrocketry listing (a different delay variant) — must NOT inflate
        // the vendor count, but counts toward listing_count.
        listing({ vendor_slug: "csrocketry", vendor_name: "Chris' Rocket Supplies", url: "u1b", price_cents: 3599 }),
        listing({
          vendor_slug: "wildman", vendor_name: "Wildman", url: "u2",
          price_cents: 6000, status: "in_stock_with_count", stock_count: 4, pack_size: 2,
        }),
        listing({ vendor_slug: "sirius", vendor_name: "Sirius Rocketry", url: "u3", price_cents: 3300, status: "out_of_stock" }),
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
      listings: [listing({ vendor_slug: "performancehobbies", vendor_name: "Performance Hobbies", url: "u4", price_cents: 8999, status: "out_of_stock" })],
    },
    // No listings — excluded.
    { id: 3, manufacturer: "AeroTech", designation: "K1100T", diameter_mm: 54, impulse_class: "K", listings: [] },
    // Sub-D (model-rocket) motor — excluded to match the site's D+ floor.
    {
      id: 4, manufacturer: "AeroTech", designation: "C6", diameter_mm: 18, impulse_class: "C",
      listings: [listing({ vendor_slug: "csrocketry", vendor_name: "Chris' Rocket Supplies", url: "u5", price_cents: 999 })],
    },
  ],
  unmatched: [],
};

const api = buildApi(snapshot);
const m1 = api.motors.motors.find((m: { id: number }) => m.id === 1);

describe("buildApi", () => {
  it("stamps schema version + generated_at on every payload", () => {
    for (const p of [api.meta, api.motors, api.inStock, api.vendors]) {
      expect(p.schema_version).toBe(SCHEMA_VERSION);
      expect(p.generated_at).toBe("2026-06-19T00:00:00.000Z");
    }
  });

  it("excludes motors with no listings AND sub-D motors", () => {
    expect(api.motors.motors.map((m: { id: number }) => m.id)).toEqual([1, 2]); // 3 (no listings) + 4 (class C) dropped
    expect(api.meta.counts.motors).toBe(2);
  });

  it("vendor_count is DISTINCT vendors, not listings", () => {
    // 4 listings (csrocketry ×2, wildman, sirius) → 3 distinct vendors.
    expect(m1.listing_count).toBe(4);
    expect(m1.vendor_count).toBe(3);
  });

  it("in_stock_vendor_count is distinct in-stock vendors", () => {
    // In stock: csrocketry ×2 + wildman → 2 distinct vendors (sirius is OOS).
    expect(m1.in_stock_vendor_count).toBe(2);
    expect(m1.in_stock).toBe(true);
  });

  it("picks the pack-aware cheapest in-stock listing (per-unit, not sticker)", () => {
    // Wildman 2-pack at $60 → $30/unit beats csrocketry's $34.99 / $35.99 singles.
    expect(m1.cheapest_in_stock.vendor_slug).toBe("wildman");
    expect(m1.cheapest_in_stock.unit_price_cents).toBe(3000);
  });

  it("collapses in_stock_with_count → in_stock with a stock_count", () => {
    const wm = m1.listings.find((l: { vendor_slug: string }) => l.vendor_slug === "wildman");
    expect(wm.status).toBe("in_stock");
    expect(wm.stock_count).toBe(4);
  });

  it("in-stock endpoint contains only motors in stock somewhere", () => {
    expect(api.inStock.motors.map((m: { id: number }) => m.id)).toEqual([1]);
  });

  it("vendor counts dedupe per motor too (motor_count = listings touched)", () => {
    const cs = api.vendors.vendors.find((v: { slug: string }) => v.slug === "csrocketry");
    expect(cs.motor_count).toBe(2); // two csrocketry listings on motor 1
    const sr = api.vendors.vendors.find((v: { slug: string }) => v.slug === "sirius");
    expect(sr.in_stock_count).toBe(0);
  });

  it("toPublicMotor omits internal-only fields", () => {
    const keys = Object.keys(toPublicMotor(snapshot.motors[0]).listings[0]);
    expect(keys).not.toContain("sku");
    expect(keys).not.toContain("raw_designation");
    expect(keys).toContain("unit_price_cents");
  });
});

describe("per-motor endpoint + slugs", () => {
  it("derives a per-motor path mirroring the site /motor URL", () => {
    expect(manufacturerSlug("Cesaroni Technology")).toBe("cesaroni");
    expect(designationToSlug("J340/M")).toBe("J340~M"); // '/' → '~'
    expect(motorApiPath(m1)).toBe("motors/aerotech/H128W.json");
  });

  it("emits one wrapped payload per motor", () => {
    const paths = api.perMotor.map((p: { path: string }) => p.path).sort();
    expect(paths).toEqual(["motors/aerotech/H128W.json", "motors/cesaroni/J360.json"]);
    const one = api.perMotor.find((p: { path: string }) => p.path === "motors/aerotech/H128W.json");
    expect(one.payload.schema_version).toBe(SCHEMA_VERSION);
    expect(one.payload.motor.designation).toBe("H128W");
  });
});

describe("openapi", () => {
  it("is a valid-ish OpenAPI 3.1 doc covering the endpoints", () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/motors/{manufacturer}/{designation}.json");
    expect(spec.components.schemas.Motor.properties.vendor_count.description).toMatch(/distinct vendors/);
    expect(api.openapi.openapi).toBe("3.1.0"); // also returned from buildApi
  });
});
