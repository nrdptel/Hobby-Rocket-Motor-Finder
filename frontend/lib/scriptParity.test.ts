// Pins the build scripts' shared helper module (scripts/derive-shared.mjs) to
// the site's canonical lib/ implementations. gen-api.mjs (public /api/v1 JSON)
// and gen-og.mjs (share cards) run as plain node before the Next build and so
// can't import the TypeScript in lib/; derive-shared.mjs is their mirror of it.
// A mirror that drifts silently is the exact bug this guards: the API and OG
// cards must size packs, hide sentinel prices, and label motors EXACTLY as the
// pages do. Every function here is run against its lib/ twin over a battery of
// adversarial inputs and a representative motor set; any divergence fails CI.
// (The motor set is inline, NOT read from data/snapshot.example.json — another
// test rewrites that shared file, which raced this reader under parallel workers.)
import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs build helper, no type declarations.
import * as shared from "../scripts/derive-shared.mjs";
import {
  cheapestInStockListing,
  designationToSlug,
  formatImpulse,
  formatPrice,
  formatThrust,
  hazmatStatus,
  isSentinelPrice,
  listingInStock,
  manufacturerLabel,
  manufacturerSlug,
} from "./derive";
import { packSize, unitPriceCents } from "./pack";
import type { Motor } from "./snapshotTypes";

// URLs / listings that exercise every pack-detection branch, including the ones
// the old inlined regex got wrong (spelled-out counts, "pack of N", URL-encoded
// spaces, over-cap counts, malformed %-escapes).
const PACK_URLS = [
  "https://v.com/motor",
  "https://v.com/motor-3-pack",
  "https://v.com/motor-3pack",
  "https://v.com/motor-12-pack",
  "https://v.com/motor-3pk",
  "https://v.com/motor-2-pk",
  "https://v.com/motor-2-motor-pack",
  "https://v.com/pack-of-3-motor",
  "https://v.com/two-pack-motor",
  "https://v.com/three-pack",
  "https://v.com/six-pack-motor",
  "https://v.com/E20-4W%20(two%20pack)",
  "https://v.com/E20-4W%20(3%20pack)",
  "https://v.com/motor-99-pack", // over MAX_PACK → single
  "https://v.com/motor-1-pack", // 1 is not a multipack
  "https://v.com/%E0%A4%A", // malformed %-escape → must not throw
  "",
];

const PRICES = [null, 0, 1, 999, 349900, 999999, 9999999, 99999999, 100000000];
const CURRENCIES = ["USD", "CAD", "EUR", "ZZZ" /* invalid ISO → fallback path */];

describe("scripts/derive-shared.mjs is in lockstep with lib/", () => {
  it("packSize matches lib across adversarial URLs and the pack_size field", () => {
    for (const url of PACK_URLS) {
      expect(shared.packSize(url)).toBe(packSize(url));
      expect(shared.packSize({ url })).toBe(packSize({ url }));
      // pack_size field takes precedence in both, incl. out-of-range → 1.
      for (const ps of [null, 1, 2, 24, 25, 3.5]) {
        expect(shared.packSize({ url, pack_size: ps })).toBe(packSize({ url, pack_size: ps }));
      }
    }
  });

  it("unitPriceCents matches lib across prices × pack URLs", () => {
    for (const price of PRICES) {
      for (const url of PACK_URLS) {
        expect(shared.unitPriceCents(price, { url })).toBe(unitPriceCents(price, { url }));
      }
    }
  });

  it("isSentinelPrice / formatPrice match lib (incl. the sentinel + bad-currency paths)", () => {
    for (const cents of PRICES) {
      expect(shared.isSentinelPrice(cents)).toBe(isSentinelPrice(cents));
      for (const cur of CURRENCIES) {
        expect(shared.formatPrice(cents, cur)).toBe(formatPrice(cents, cur));
      }
    }
  });

  it("formatImpulse / formatThrust match lib", () => {
    for (const n of [null, 0, 0.4, 1, 128, 176.2, 6000, 33333]) {
      expect(shared.formatImpulse(n)).toBe(formatImpulse(n));
      expect(shared.formatThrust(n)).toBe(formatThrust(n));
    }
  });

  it("hazmatStatus matches lib across motor types / classes / weights", () => {
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
      { motor_type: "reload", impulse_class: "g", prop_weight_g: 30 }, // lowercase
      { motor_type: "hybrid", impulse_class: "M", prop_weight_g: 3433 },
      { motor_type: null, impulse_class: "", prop_weight_g: null },
    ];
    for (const c of cases) {
      expect(shared.hazmatStatus(c)).toBe(hazmatStatus(c as unknown as Motor));
    }
  });

  it("manufacturer / designation slugs + listingInStock match lib", () => {
    for (const mfr of ["AeroTech", "Cesaroni Technology", "Loki Research", "Other"]) {
      expect(shared.manufacturerLabel(mfr)).toBe(manufacturerLabel(mfr));
      expect(shared.manufacturerSlug(mfr)).toBe(manufacturerSlug(mfr));
    }
    for (const d of ["H128W", "J340/M", "F20W/L", "M1500"]) {
      expect(shared.designationToSlug(d)).toBe(designationToSlug(d));
    }
    for (const s of ["in_stock", "in_stock_with_count", "out_of_stock", "special_order", "unknown"]) {
      expect(shared.listingInStock(s)).toBe(listingInStock(s));
    }
  });

  // Run the shared helpers against lib over a representative multi-motor set that
  // hits every branch on real-shaped records: hazmat across motor types/classes,
  // pack-URL and pack_size listings, sentinel/null/foreign-currency prices, and
  // mixed stock states. Inline so it can't race the shared example-snapshot file.
  it("agrees with lib over a representative motor + listing set", () => {
    const listing = (over: Record<string, unknown>) => ({
      vendor_slug: "csrocketry",
      vendor_name: "Chris' Rocket Supplies",
      url: "https://v.example/p",
      price_cents: 3499,
      currency: "USD",
      status: "in_stock",
      stock_count: null,
      ...over,
    });
    const motors = [
      // H-class (hazmat required), multi-vendor with a pack, an OOS, and a null price.
      { manufacturer: "AeroTech", impulse_class: "H", motor_type: "reload", prop_weight_g: 120, listings: [
        listing({ vendor_slug: "wildman", vendor_name: "Wildman", url: "https://v/x-2-pack", price_cents: 6000, status: "in_stock_with_count", stock_count: 4, pack_size: 2 }),
        listing({ vendor_slug: "sirius", vendor_name: "Sirius", price_cents: null, status: "in_stock" }),
        listing({ vendor_slug: "amw", vendor_name: "AMW", price_cents: 3300, status: "out_of_stock" }),
      ] },
      // Hybrid (hazmat none despite heavy propellant); CAD + sentinel + special-order.
      { manufacturer: "AeroTech", impulse_class: "M", motor_type: "hybrid", prop_weight_g: 3433, listings: [
        listing({ vendor_slug: "performancehobbies", vendor_name: "Performance Hobbies", price_cents: 99999999, currency: "CAD", status: "special_order" }),
      ] },
      // F/G band (hazmat varies vs required by weight); "two pack" URL; unknown currency.
      { manufacturer: "Cesaroni Technology", impulse_class: "F", motor_type: "SU", prop_weight_g: 45, listings: [
        listing({ vendor_slug: "moto_joe", vendor_name: "Moto-Joe", url: "https://v/two-pack-x", price_cents: 2000, currency: "ZZZ" }),
      ] },
      { manufacturer: "Cesaroni Technology", impulse_class: "G", motor_type: "reload", prop_weight_g: 72, listings: [] },
      // E-class (hazmat none) and a Loki motor with nothing in stock.
      { manufacturer: "Loki Research", impulse_class: "E", motor_type: "reload", prop_weight_g: 40, listings: [
        listing({ vendor_slug: "loki", vendor_name: "Loki", price_cents: 1999, status: "out_of_stock" }),
      ] },
    ];

    let checked = 0;
    for (const m of motors) {
      expect(shared.hazmatStatus(m)).toBe(hazmatStatus(m as unknown as Motor));
      const a = shared.cheapestInStockListing(m);
      const b = cheapestInStockListing(m as unknown as Motor);
      expect(a?.url ?? null).toBe(b?.url ?? null);
      for (const l of m.listings) {
        expect(shared.packSize(l)).toBe(packSize(l));
        expect(shared.unitPriceCents(l.price_cents, l)).toBe(unitPriceCents(l.price_cents, l));
        expect(shared.formatPrice(l.price_cents, l.currency)).toBe(formatPrice(l.price_cents, l.currency));
        expect(shared.listingInStock(l.status)).toBe(listingInStock(l.status));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // the set actually exercised the helpers
  });
});
