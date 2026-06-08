// Pure "what can I fly in this rocket right now" logic — given a saved rocket
// and the catalog, produce a ranked, buy-focused loadout: the in-stock motors
// that fit (cheapest first), and, when nothing that fits is buyable, the closest
// in-stock SWAPS (same mount + cert, nearest impulse). No React, no DOM.

import { cheapestInStockCents, cheapestInStockListing, motorInStock } from "./derive";
import { motorFitsRocket, type RocketSpec } from "./rocketFit";
import type { Listing, Motor } from "./snapshot";

export type LoadoutEntry = {
  motor: Motor;
  inStock: boolean;
  cheapestCents: number | null;
  cheapestListing: Listing | null;
  /** True for an exact fit; false for a relaxed swap (different impulse band). */
  fitsExactly: boolean;
};

export type RocketLoadout = {
  /** Exact-fit motors that are in stock, cheapest first. */
  inStock: LoadoutEntry[];
  /** Exact-fit motors total (any stock). */
  totalFit: number;
  /** Exact-fit motors that are sold out everywhere. */
  soldOutFit: number;
  /** Closest in-stock swaps (same mount + cert, nearest impulse) — only when
   * nothing that fits exactly is in stock. */
  swaps: LoadoutEntry[];
};

function entry(m: Motor, fitsExactly: boolean): LoadoutEntry {
  return {
    motor: m,
    inStock: motorInStock(m),
    cheapestCents: cheapestInStockCents(m),
    cheapestListing: cheapestInStockListing(m),
    fitsExactly,
  };
}

// Cheapest in-stock first; a motor with no known price sorts last.
function byPrice(a: LoadoutEntry, b: LoadoutEntry): number {
  return (a.cheapestCents ?? Infinity) - (b.cheapestCents ?? Infinity);
}

/** The rocket's target total impulse (the band midpoint, or whichever bound is
 * set), or null when it pins no impulse band. */
function targetImpulse(r: RocketSpec): number | null {
  if (r.minImpulseNs != null && r.maxImpulseNs != null) return (r.minImpulseNs + r.maxImpulseNs) / 2;
  return r.minImpulseNs ?? r.maxImpulseNs ?? null;
}

/** Build the loadout for a rocket over the full catalog. `swapLimit` caps the
 * number of fallback swaps shown. */
export function buildRocketLoadout(
  rocket: RocketSpec,
  allMotors: readonly Motor[],
  opts: { swapLimit?: number } = {},
): RocketLoadout {
  const swapLimit = opts.swapLimit ?? 6;

  // Only motors a vendor actually sells — "phantom" catalog motors (no listings)
  // can't be flown, so they never count toward fits or the sold-out tally.
  const fitting = allMotors.filter((m) => m.listings.length > 0 && motorFitsRocket(rocket, m));
  const entries = fitting.map((m) => entry(m, true));
  const inStock = entries.filter((e) => e.inStock).sort(byPrice);
  const soldOutFit = entries.length - inStock.length;

  // Swaps only matter when nothing that fits is actually buyable. Relax to the
  // same mount + cert (cert is a hard limit — never suggest above the flyer's
  // rating), dropping the class/case/impulse narrowings, and rank by closeness
  // to the rocket's target impulse (then price).
  let swaps: LoadoutEntry[] = [];
  if (inStock.length === 0) {
    const exactIds = new Set(fitting.map((m) => m.id));
    const relaxed: RocketSpec = {
      diameterMm: rocket.diameterMm,
      cert: rocket.cert,
      impulseClasses: [],
      caseInfos: [],
      minImpulseNs: null,
      maxImpulseNs: null,
    };
    const target = targetImpulse(rocket);
    swaps = allMotors
      .filter((m) => !exactIds.has(m.id) && motorFitsRocket(relaxed, m))
      .map((m) => entry(m, false))
      .filter((e) => e.inStock)
      .sort((a, b) => {
        if (target != null) {
          const da = Math.abs((a.motor.total_impulse_ns ?? Infinity) - target);
          const db = Math.abs((b.motor.total_impulse_ns ?? Infinity) - target);
          if (da !== db) return da - db;
        }
        return byPrice(a, b);
      })
      .slice(0, swapLimit);
  }

  return { inStock, totalFit: entries.length, soldOutFit, swaps };
}
