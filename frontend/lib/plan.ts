// Order-planning math: given a list of wanted motors (with quantities) and an
// estimated shipping/HAZMAT cost per order, find the cheapest way to buy them all
// across the tracked vendors — trading motor price against the number of separate
// shipments (each shipment = one HAZMAT fee). Pure + unit-tested; no React/DOM.

import { findSubstitutes, listingInStock } from "./derive";
import type { Motor } from "./snapshot";

export type PlanItem = { motor: Motor; qty: number };

type Offer = { vendorSlug: string; vendorName: string; unitPriceCents: number; url: string };

export type AssignmentLine = { motor: Motor; qty: number; unitPriceCents: number; url: string };
export type VendorAssignment = {
  vendorSlug: string;
  vendorName: string;
  lines: AssignmentLine[];
  subtotalCents: number;
};

export type OrderPlan = {
  /** The chosen vendor split (cheapest total), grouped by vendor. */
  assignments: VendorAssignment[];
  ordersCount: number;
  motorCostCents: number;
  shippingCents: number;
  totalCents: number;
  /** Motors not in stock (in the wanted qty) at ANY vendor. */
  unavailable: Motor[];
};

export type SingleVendorOption = {
  vendorSlug: string;
  vendorName: string;
  covers: number; // wanted-and-coverable motors this vendor can supply
  coverable: number; // total wanted-and-coverable motors
  motorCostCents: number; // cost of what it covers
  missing: Motor[]; // coverable motors it can't supply
};

/** Per-vendor cheapest in-stock unit price for one wanted item. A listing only
 * counts if it's in stock, has a price, and (when the vendor reports an exact
 * count) has at least the wanted quantity. */
export function vendorOffers(item: PlanItem): Offer[] {
  const best = new Map<string, Offer>();
  for (const l of item.motor.listings) {
    if (!listingInStock(l.status) || l.price_cents == null) continue;
    if (l.stock_count != null && l.stock_count < item.qty) continue;
    const cur = best.get(l.vendor_slug);
    if (!cur || l.price_cents < cur.unitPriceCents) {
      best.set(l.vendor_slug, {
        vendorSlug: l.vendor_slug,
        vendorName: l.vendor_name,
        unitPriceCents: l.price_cents,
        url: l.url,
      });
    }
  }
  return [...best.values()];
}

/** Cheapest end-to-end plan: minimizes (motor cost) + (shipping × #orders) over
 * every subset of vendors. The catalog has ~10 vendors and a wanted list only
 * touches a handful, so the 2^V brute force is tiny and exact. */
export function buildOrderPlan(items: PlanItem[], shippingCents: number): OrderPlan {
  const wanted = items.filter((it) => it.qty > 0);
  const offers = wanted.map(vendorOffers);
  const coverable: number[] = [];
  const unavailable: Motor[] = [];
  wanted.forEach((it, i) => (offers[i].length > 0 ? coverable.push(i) : unavailable.push(it.motor)));

  // Vendor universe = every vendor that can supply at least one wanted motor.
  const vendorName = new Map<string, string>();
  for (const i of coverable) for (const o of offers[i]) vendorName.set(o.vendorSlug, o.vendorName);
  const vendors = [...vendorName.keys()];

  // offerBySlug[c] = vendorSlug -> Offer, for quick lookup inside the search.
  const offerBySlug = coverable.map((i) => {
    const m = new Map<string, Offer>();
    for (const o of offers[i]) m.set(o.vendorSlug, o);
    return m;
  });

  let bestUsed: Set<string> | null = null;
  let bestTotal = Infinity;
  let bestMotorCost = 0;

  for (let mask = 1; mask < 1 << vendors.length; mask++) {
    const inMask: string[] = [];
    for (let b = 0; b < vendors.length; b++) if (mask & (1 << b)) inMask.push(vendors[b]);

    let motorCost = 0;
    const used = new Set<string>();
    let covered = true;
    for (let c = 0; c < coverable.length; c++) {
      let minSlug = "";
      let min = Infinity;
      for (const slug of inMask) {
        const o = offerBySlug[c].get(slug);
        if (o && o.unitPriceCents < min) {
          min = o.unitPriceCents;
          minSlug = slug;
        }
      }
      if (min === Infinity) {
        covered = false;
        break;
      }
      motorCost += min * wanted[coverable[c]].qty;
      used.add(minSlug);
    }
    if (!covered) continue;
    const total = motorCost + shippingCents * used.size;
    if (total < bestTotal) {
      bestTotal = total;
      bestUsed = used;
      bestMotorCost = motorCost;
    }
  }

  // Build the grouped assignment from the winning vendor set.
  const assignments: VendorAssignment[] = [];
  if (bestUsed) {
    const byVendor = new Map<string, AssignmentLine[]>();
    for (let c = 0; c < coverable.length; c++) {
      let chosen: Offer | undefined;
      for (const slug of bestUsed) {
        const o = offerBySlug[c].get(slug);
        if (o && o.unitPriceCents < (chosen?.unitPriceCents ?? Infinity)) chosen = o;
      }
      if (!chosen) continue;
      const it = wanted[coverable[c]];
      const line: AssignmentLine = {
        motor: it.motor,
        qty: it.qty,
        unitPriceCents: chosen.unitPriceCents,
        url: chosen.url,
      };
      const slug = chosen.vendorSlug;
      (byVendor.get(slug) ?? byVendor.set(slug, []).get(slug)!).push(line);
    }
    for (const [slug, lines] of byVendor) {
      const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
      assignments.push({
        vendorSlug: slug,
        vendorName: vendorName.get(slug) ?? slug,
        lines,
        subtotalCents: subtotal,
      });
    }
    // Most-stocked / cheapest first.
    assignments.sort((a, b) => b.lines.length - a.lines.length || a.subtotalCents - b.subtotalCents);
  }

  const ordersCount = assignments.length;
  return {
    assignments,
    ordersCount,
    motorCostCents: bestUsed ? bestMotorCost : 0,
    shippingCents: shippingCents * ordersCount,
    totalCents: bestUsed ? bestMotorCost + shippingCents * ordersCount : 0,
    unavailable,
  };
}

/** The best "everything from one vendor" option (fewest possible shipments): the
 * vendor covering the most wanted motors, cheapest as a tiebreak. */
export function bestSingleVendor(items: PlanItem[]): SingleVendorOption | null {
  const wanted = items.filter((it) => it.qty > 0);
  const offers = wanted.map(vendorOffers);
  const coverableItems = wanted.filter((_, i) => offers[i].length > 0);
  if (coverableItems.length === 0) return null;

  const vendorName = new Map<string, string>();
  for (const list of offers) for (const o of list) vendorName.set(o.vendorSlug, o.vendorName);

  let best: SingleVendorOption | null = null;
  for (const [slug, name] of vendorName) {
    let covers = 0;
    let cost = 0;
    const missing: Motor[] = [];
    wanted.forEach((it, i) => {
      if (offers[i].length === 0) return; // not coverable by anyone
      const o = offers[i].find((x) => x.vendorSlug === slug);
      if (o) {
        covers += 1;
        cost += o.unitPriceCents * it.qty;
      } else {
        missing.push(it.motor);
      }
    });
    const option: SingleVendorOption = {
      vendorSlug: slug,
      vendorName: name,
      covers,
      coverable: coverableItems.length,
      motorCostCents: cost,
      missing,
    };
    if (!best || option.covers > best.covers || (option.covers === best.covers && option.motorCostCents < best.motorCostCents)) {
      best = option;
    }
  }
  return best;
}

export type SwapSuggestion = { soldOut: Motor; swaps: Motor[] };

/** For each sold-out-everywhere motor on the order, the best IN-STOCK substitutes
 * to buy instead — same mount + impulse class, within the substitute bands — so
 * the order is actually completable during a shortage. Excludes anything already
 * on the order (`excludeIds`), and keeps every sold-out motor in the result (even
 * with no swaps) so the caller can still offer a restock alert. */
export function buildSwapSuggestions(
  unavailable: readonly Motor[],
  allMotors: readonly Motor[],
  excludeIds: ReadonlySet<number>,
  perMotor = 3,
): SwapSuggestion[] {
  return unavailable.map((soldOut) => ({
    soldOut,
    swaps: findSubstitutes(soldOut, allMotors)
      .filter((s) => !excludeIds.has(s.id))
      .slice(0, perMotor),
  }));
}
