// Guards the public /api/v1 contract. The generator's pure transform lives in
// scripts/gen-api.mjs (single source for both the build output and this test);
// allowJs in tsconfig lets us import it here.
import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs build script, no type declarations.
import {
  SCHEMA_VERSION,
  buildApi,
  buildAvailability,
  buildOpenApi,
  designationToSlug,
  hazmatStatus as hazmatStatusApi,
  isoUtcZ,
  manufacturerSlug,
  motorApiPath,
  toPublicMotor,
} from "../scripts/gen-api.mjs";
import { hazmatStatus as hazmatStatusDerive } from "./derive";

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

  it("vendors.json motor_count is DISTINCT motors, not listings", () => {
    // csrocketry has two listings on motor 1 (and one on the excluded sub-D motor)
    // → it carries exactly ONE in-scope motor.
    const cs = api.vendors.vendors.find((v: { slug: string }) => v.slug === "csrocketry");
    expect(cs.motor_count).toBe(1);
    expect(cs.in_stock_count).toBe(1);
    const sr = api.vendors.vendors.find((v: { slug: string }) => v.slug === "sirius");
    expect(sr.in_stock_count).toBe(0); // sirius listing is out of stock
  });

  it("each motor carries its own per-motor endpoint (path)", () => {
    expect(m1.path).toBe("/api/v1/motors/aerotech/H128W.json");
    const j = api.motors.motors.find((m: { id: number }) => m.id === 2);
    expect(j.path).toBe("/api/v1/motors/cesaroni/J360.json");
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

describe("buildAvailability (bulk feed for Muster)", () => {
  const feed = buildAvailability(api);

  it("keys by <mfr-slug>/<designation> over the same D+ listed set as the API", () => {
    // Same universe as /api: motor 3 (no listings) + motor 4 (sub-D) are absent.
    expect(Object.keys(feed.motors).sort()).toEqual(["aerotech/H128W", "cesaroni/J360"]);
  });

  it("summarizes distinct vendors + distinct in-stock vendors (no prices)", () => {
    // H128W: 3 distinct vendors (csrocketry ×2, wildman, sirius), 2 in stock.
    expect(feed.motors["aerotech/H128W"]).toEqual({ vendors: 3, inStock: 2 });
    // J360: one vendor, out of stock.
    expect(feed.motors["cesaroni/J360"]).toEqual({ vendors: 1, inStock: 0 });
    // Summary only — no price/url fields leak in.
    expect(Object.keys(feed.motors["aerotech/H128W"])).toEqual(["vendors", "inStock"]);
  });

  it("stamps _generated as ISO-8601 UTC with a Z suffix (no offset, no millis)", () => {
    expect(feed._generated).toBe("2026-06-19T00:00:00Z");
    expect(isoUtcZ("2026-07-03T01:03:02+00:00")).toBe("2026-07-03T01:03:02Z");
    expect(isoUtcZ(null)).toBeNull();
  });

  it("also emits the '~' URL-path spelling as an alias for slashed designations", () => {
    // A designation with '/' (a few AeroTech motors) — the site URL encodes it as
    // '~'. Both the verbatim ThrustCurve key and the exact page-URL path resolve.
    const snap2 = {
      generated_at: "2026-06-19T00:00:00.000Z",
      motors: [
        {
          id: 9, manufacturer: "AeroTech", designation: "F42T/L", diameter_mm: 29, impulse_class: "F",
          listings: [listing({ vendor_slug: "wildman", vendor_name: "Wildman", url: "u", price_cents: 2000 })],
        },
      ],
      unmatched: [],
    };
    const f2 = buildAvailability(buildApi(snap2));
    expect(f2.motors["aerotech/F42T/L"]).toEqual({ vendors: 1, inStock: 1 }); // verbatim
    expect(f2.motors["aerotech/F42T~L"]).toEqual({ vendors: 1, inStock: 1 }); // URL-path alias
  });
});

describe("openapi", () => {
  it("is a valid-ish OpenAPI 3.1 doc covering the endpoints", () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/motors/{manufacturer}/{designation}.json");
    expect(spec.components.schemas.Motor.properties.vendor_count.description).toMatch(/distinct vendors/);
    // Every operation has an operationId + a documented 404 (lint-clean).
    for (const path of Object.values(spec.paths) as { get: { operationId: string; responses: Record<string, unknown> } }[]) {
      expect(path.get.operationId).toBeTruthy();
      expect(path.get.responses["404"]).toBeTruthy();
    }
    expect(api.openapi.openapi).toBe("3.1.0"); // also returned from buildApi
  });
});

describe("hazmat parity (gen-api mirror of lib/derive)", () => {
  // The API mirrors lib/derive's hazmatStatus by hand; this fails if they drift.
  it("gen-api hazmatStatus matches lib/derive across a battery of motors", () => {
    const cases = [
      { motor_type: "reload", impulse_class: "D", prop_weight_g: 10 },
      { motor_type: "reload", impulse_class: "E", prop_weight_g: 62.5 },
      { motor_type: "SU", impulse_class: "F", prop_weight_g: 45 },
      { motor_type: "SU", impulse_class: "F", prop_weight_g: 70 },
      { motor_type: "reload", impulse_class: "G", prop_weight_g: 62.5 },
      { motor_type: "reload", impulse_class: "G", prop_weight_g: 72 },
      { motor_type: "reload", impulse_class: "H", prop_weight_g: 120 },
      { motor_type: "reload", impulse_class: "I", prop_weight_g: null },
      { motor_type: "reload", impulse_class: "P", prop_weight_g: null },
      { motor_type: "hybrid", impulse_class: "M", prop_weight_g: 3433 },
      { motor_type: null, impulse_class: "", prop_weight_g: null },
    ];
    for (const c of cases) {
      // @ts-expect-error — gen-api is untyped JS.
      expect(hazmatStatusApi(c)).toBe(hazmatStatusDerive(c as never));
    }
  });
});
