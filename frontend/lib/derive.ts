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

/** Format total impulse in newton-seconds. ``237`` → ``237 N·s``. */
export function formatImpulse(ns: number | null): string {
  if (ns == null) return "—";
  return `${ns.toFixed(0)} N·s`;
}

/** Format average thrust in newtons for the table. ``242`` → ``242 N``. */
export function formatThrust(newtons: number | null): string {
  if (newtons == null) return "—";
  return `${Math.round(newtons)} N`;
}

/** Format burn time in seconds. Sub-second motors keep two decimals so a
 * 0.3 s and 0.98 s motor stay distinguishable; longer burns round to one. */
export function formatBurn(seconds: number | null): string {
  if (seconds == null) return "—";
  return seconds < 1 ? `${seconds.toFixed(2)} s` : `${seconds.toFixed(1)} s`;
}

/** A listing's data is "stale" once it's older than this, measured against the
 * snapshot's own ``generated_at``. Scrapes run hourly and a single run's fresh
 * listings span only ~15 min, so 45 min sits comfortably above fresh data while
 * still catching a vendor carried forward for even one cycle (~75 min old: the
 * ~1 h cadence plus the prior run's intra-run offset). A higher bound would
 * silently miss first-cycle carry-forwards — the exact case worth surfacing. */
export const STALE_MS = 45 * 60 * 1000;

/** Human age label for a listing's ``seen_at``, or ``null`` when the data is
 * fresh enough not to warrant flagging. ``now`` is injected so the function
 * stays pure and testable; pass the snapshot's ``generated_at``. */
export function staleLabel(seenAt: string, now: Date): string | null {
  const seen = new Date(seenAt).getTime();
  const ref = now.getTime();
  if (Number.isNaN(seen) || Number.isNaN(ref)) return null;
  const ageMs = ref - seen;
  if (ageMs < STALE_MS) return null;
  const hours = ageMs / 3_600_000;
  if (hours < 24) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
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

/** Short, human display name for a manufacturer. ThrustCurve stores Cesaroni
 * as "Cesaroni Technology"; shorten it for the UI. Everything else is shown
 * verbatim. Used for both the table column and the filter pills, so the URL
 * filter value matches what the user sees. */
export function manufacturerLabel(manufacturer: string): string {
  if (manufacturer === "Cesaroni Technology") return "Cesaroni";
  return manufacturer;
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

/** The lowest in-stock price (in cents) among a set of listings for the *same*
 * variety, or ``null`` when there's nothing to highlight. Returns null unless
 * at least two in-stock listings carry a price — with zero or one, there's no
 * comparison to make, so flagging a "best price" would be noise. Compared at
 * the variety (delay-group) level rather than across a whole motor, since
 * different delays can be genuinely different products. */
export function bestInStockPriceCents(listings: Listing[]): number | null {
  const priced = listings
    .filter((l) => listingInStock(l.status) && l.price_cents != null)
    .map((l) => l.price_cents as number);
  if (priced.length < 2) return null;
  return Math.min(...priced);
}

/** True when this listing should carry the "best price" marker: it's in stock
 * and its price ties the group's lowest (``bestCents`` from
 * ``bestInStockPriceCents``). ``bestCents == null`` means nothing to flag. */
export function isBestInStockPrice(listing: Listing, bestCents: number | null): boolean {
  return (
    bestCents != null &&
    listingInStock(listing.status) &&
    listing.price_cents === bestCents
  );
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

/** How listings are ordered within a delay group. Both modes keep in-stock
 * listings above out-of-stock ones (a cheap OOS listing helps nobody); they
 * differ only in the tiebreak. ``"stock"`` then sorts alphabetically by
 * vendor, ``"price"`` by ascending price (missing prices last). */
export type ListingSort = "stock" | "price";

/** Tiebreak comparator for listings already known to share stock state. */
function listingTiebreak(a: Listing, b: Listing, sort: ListingSort): number {
  if (sort === "price") {
    const ap = a.price_cents ?? Number.POSITIVE_INFINITY;
    const bp = b.price_cents ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
  }
  return a.vendor_name.localeCompare(b.vendor_name);
}

/** Group a motor's listings by delay code so the table can collapse
 * same-delay rows with ``rowSpan``. Listings within a group are sorted
 * in-stock-first then by the chosen tiebreak (vendor name, or price for
 * ``"price"``); groups are sorted by their delay sort key. */
export function groupByDelay(motor: Motor, sort: ListingSort = "stock"): GroupedMotor {
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
      // In-stock first, then the chosen tiebreak.
      listings: [...g.listings].sort((a, b) => {
        const ai = listingInStock(a.status) ? 0 : 1;
        const bi = listingInStock(b.status) ? 0 : 1;
        if (ai !== bi) return ai - bi;
        return listingTiebreak(a, b, sort);
      }),
    }))
    .sort((a, b) => a.delaySortKey - b.delaySortKey);
  return { ...motor, delayGroups };
}
