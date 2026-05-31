// Pure data-shaping helpers used by app/page.tsx. They take no React and
// no DOM, so they're trivially unit-testable and don't need a JSX runtime
// to exercise. If the table renders something garbled, the bug is almost
// always in here, not in the JSX.

import type { Listing, Motor } from "./snapshot";

/** Lower bound on impulse class shown by the UI — D and up. Hides A/B/C
 * Estes-style model rocket motors that aren't this project's audience. */
export const MIN_CLASS = "D";

export type DelayGroup = {
  delay: string;
  delaySortKey: number;
  variety: string;
  listings: Listing[];
};

export type GroupedMotor = Motor & { delayGroups: DelayGroup[] };

/** Format a price stored as integer cents into a human currency string. */
export function formatPrice(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}

/** Pull a delay code out of a vendor-style designation, returning the
 * human display form. ``D13-10W`` → ``10s``, ``H242T-14A`` → ``14s adj``,
 * ``M1500`` → null. */
export function extractDelay(designation: string): string | null {
  if (!designation) return null;
  const m = designation.match(/-(\d{1,2})([A-Z]?)/);
  if (!m) return null;
  const seconds = m[1];
  const adjustable = m[2] === "A";
  return adjustable ? `${seconds}s adj` : `${seconds}s`;
}

/** Resolve the delay column for a single listing row, falling back from
 * the vendor SKU to the motor's catalog ``delays`` field if the SKU
 * doesn't carry a delay (e.g. bare M-class motors). */
export function delayForRow(rawDesignation: string, motor: Motor): string {
  const fromSku = extractDelay(rawDesignation);
  if (fromSku) return fromSku;
  const d = motor.delays;
  if (!d) return "—";
  if (d === "P") return "plugged";
  const isMulti = d.includes(",");
  if (motor.delay_adjustable) {
    return isMulti ? `${d} adj` : `${d}s adj`;
  }
  return `${d}s`;
}

/** Sort key for a single motor row: class → diameter → designation. */
export function rankMotor(m: Motor): [string, number, string] {
  return [m.impulse_class, m.diameter_mm, m.designation];
}

/** Outbound link to the canonical ThrustCurve page for this motor. */
export function thrustcurveUrl(m: Motor): string {
  return `https://www.thrustcurve.org/motors/${encodeURIComponent(m.manufacturer)}/${encodeURIComponent(m.designation)}/`;
}

/** Sort motors for display: class first, then diameter ascending, then
 * designation alphabetical. */
export function sortedMotors(motors: Motor[]): Motor[] {
  return [...motors].sort((a, b) => {
    const [ac, ad, an] = rankMotor(a);
    const [bc, bd, bn] = rankMotor(b);
    if (ac !== bc) return ac.localeCompare(bc);
    if (ad !== bd) return ad - bd;
    return an.localeCompare(bn);
  });
}

/** Read a comma-separated multi-value query parameter into a Set. */
export function parseSetParam(v: string | string[] | undefined): Set<string> {
  if (!v) return new Set();
  const raw = Array.isArray(v) ? v.join(",") : v;
  return new Set(raw.split(",").filter(Boolean));
}

/** True when a listing's status means a customer could buy it right now. */
export function listingInStock(status: string): boolean {
  return status === "in_stock_with_count" || status === "in_stock";
}

/** Numeric sort key for a delay display string. ``"—"`` last,
 * ``"plugged"`` first, anything else by its leading integer. */
export function delaySortKey(delay: string): number {
  if (delay === "—") return Number.POSITIVE_INFINITY;
  if (delay === "plugged") return -1;
  // Take the first numeric value found ("4s" -> 4, "6,8,10,12,14 adj" -> 6).
  const m = delay.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY;
}

/** Group a motor's listings by delay code so the table can collapse
 * same-delay rows with ``rowSpan``. Listings within a group are sorted
 * in-stock-first then alphabetical by vendor; groups are sorted by their
 * delay sort key. */
export function groupByDelay(motor: Motor): GroupedMotor {
  const byDelay = new Map<string, DelayGroup>();
  for (const l of motor.listings) {
    const delay = delayForRow(l.raw_designation, motor);
    const existing = byDelay.get(delay);
    if (existing) {
      existing.listings.push(l);
    } else {
      byDelay.set(delay, {
        delay,
        delaySortKey: delaySortKey(delay),
        variety: l.raw_designation || motor.designation,
        listings: [l],
      });
    }
  }
  const delayGroups = Array.from(byDelay.values())
    .map((g) => ({
      ...g,
      // In-stock first, then alphabetical by vendor.
      listings: [...g.listings].sort((a, b) => {
        const ai = listingInStock(a.status) ? 0 : 1;
        const bi = listingInStock(b.status) ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return a.vendor_name.localeCompare(b.vendor_name);
      }),
    }))
    .sort((a, b) => a.delaySortKey - b.delaySortKey);
  return { ...motor, delayGroups };
}
