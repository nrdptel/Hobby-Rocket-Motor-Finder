// Pins the build scripts' shared helper module (scripts/derive-shared.mjs) to
// the site's canonical lib/ implementations. gen-api.mjs (public /api/v1 JSON)
// and gen-og.mjs (share cards) run as plain node before the Next build and so
// can't import the TypeScript in lib/; derive-shared.mjs is their mirror of it.
// A mirror that drifts silently is the exact bug this guards: the API and OG
// cards must size packs, hide sentinel prices, and label motors EXACTLY as the
// pages do. Every function here is run against its lib/ twin over a battery of
// adversarial inputs and the whole example snapshot; any divergence fails CI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  // The strongest guard: run the shared helpers against lib over EVERY real
  // listing/motor in the example snapshot, not just crafted inputs.
  it("agrees with lib over every motor + listing in the example snapshot", () => {
    const path = fileURLToPath(new URL("../data/snapshot.example.json", import.meta.url));
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as { motors: Motor[] };
    let motors = 0;
    let listings = 0;
    for (const m of snapshot.motors) {
      expect(shared.hazmatStatus(m)).toBe(hazmatStatus(m));
      const a = shared.cheapestInStockListing(m);
      const b = cheapestInStockListing(m);
      expect(a?.url ?? null).toBe(b?.url ?? null);
      motors++;
      for (const l of m.listings ?? []) {
        expect(shared.packSize(l)).toBe(packSize(l));
        expect(shared.unitPriceCents(l.price_cents, l)).toBe(unitPriceCents(l.price_cents, l));
        expect(shared.formatPrice(l.price_cents, l.currency)).toBe(formatPrice(l.price_cents, l.currency));
        expect(shared.listingInStock(l.status)).toBe(listingInStock(l.status));
        listings++;
      }
    }
    // Sanity: the snapshot actually exercised the helpers (not a silent empty loop).
    expect(motors).toBeGreaterThan(100);
    expect(listings).toBeGreaterThan(100);
  });
});
