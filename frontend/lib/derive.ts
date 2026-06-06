// Pure data-shaping helpers used by app/page.tsx. They take no React and
// no DOM, so they're trivially unit-testable and don't need a JSX runtime
// to exercise. If the table renders something garbled, the bug is almost
// always in here, not in the JSX.

import type { ListingHistory, Listing, Motor } from "./snapshot";

/** Lower bound on impulse class shown by the UI — D and up. Hides A/B/C
 * Estes-style model rocket motors that aren't this project's audience. */
export const MIN_CLASS = "D";

/** NAR/Tripoli certification ladder, by impulse class (which is itself a total-
 * impulse bracket). High-power certification is gated by total impulse:
 * L1 = H–I, L2 = J–L, L3 = M–O; D–G need no HPR cert. Lets a flyer filter to
 * exactly what they're rated to buy and fly, and powers the per-motor cert badge.
 * Order matters: rendered as a ladder. */
export const CERT_LEVELS: ReadonlyArray<{
  key: string;
  label: string;
  sublabel: string;
  classes: readonly string[];
}> = [
  { key: "mid", label: "Mid-power", sublabel: "D–G", classes: ["D", "E", "F", "G"] },
  { key: "l1", label: "L1", sublabel: "H–I", classes: ["H", "I"] },
  { key: "l2", label: "L2", sublabel: "J–L", classes: ["J", "K", "L"] },
  { key: "l3", label: "L3", sublabel: "M–O", classes: ["M", "N", "O"] },
];

const CLASS_TO_CERT: ReadonlyMap<string, { key: string; label: string; sublabel: string }> =
  new Map(
    CERT_LEVELS.flatMap((lvl) =>
      lvl.classes.map((c) => [c, { key: lvl.key, label: lvl.label, sublabel: lvl.sublabel }]),
    ),
  );

/** The set of impulse classes covered by the selected cert-level keys (the
 * ``?cert=`` URL param). Empty selection → empty set (no cert filtering). */
export function certClasses(selected: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const lvl of CERT_LEVELS) {
    if (selected.has(lvl.key)) for (const c of lvl.classes) out.add(c);
  }
  return out;
}

/** The cert level a motor's impulse class falls under, or null for classes
 * below H (no HPR cert) / unknown. Used for the per-motor cert badge. */
export function certForClass(
  impulseClass: string,
): { key: string; label: string; sublabel: string } | null {
  const cert = CLASS_TO_CERT.get(impulseClass);
  // Mid-power (D–G) isn't an HPR "certification", so it gets no badge.
  return cert && cert.key !== "mid" ? cert : null;
}

export type DelayGroup = {
  delay: string;
  delaySortKey: number;
  variety: string;
  listings: Listing[];
};

export type GroupedMotor = Motor & { delayGroups: DelayGroup[] };

/** Format a price stored as integer cents into a human currency string.
 *
 * Defensive: ``Intl.NumberFormat`` throws a RangeError on an invalid ISO
 * currency code, and ``currency`` can come straight from scraped vendor JSON-LD.
 * A single bad value would otherwise crash the whole server-rendered page, so we
 * fall back to a plain dollar string rather than let one poisoned listing take
 * the site down. */
export function formatPrice(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
      cents / 100,
    );
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/** Return ``url`` only if it's a safe http(s) link, else ``"#"``. Listing URLs
 * come from scraped vendor data; React neutralizes ``javascript:`` hrefs but not
 * ``data:``/``vbscript:``, so we whitelist the scheme before putting it in an
 * ``href``. */
export function safeHref(url: string | null | undefined): string {
  if (!url) return "#";
  return /^https?:\/\//i.test(url.trim()) ? url : "#";
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

// How recent a restock must be to surface "restocked Xh ago" (in-stock rows),
// and how recently a now-out-of-stock listing was last in stock to surface
// "last in stock Xd ago". Both windows keep the badge to genuinely actionable,
// recent events — older history shows nothing, so the table stays uncluttered.
export const RESTOCK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const LAST_STOCK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Compact age like ``3h`` / ``2d`` (minimum ``1h``, so we never print ``0h``). */
function ageLabel(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Restock-timing label for a listing, or ``null`` when there's nothing worth
 * showing. ``now`` is injected (pass the snapshot's ``generated_at``) so the
 * function stays pure and testable.
 *
 * - In stock with a genuine restock in the last ~14 days → ``restocked 3h ago``.
 *   (A listing in stock continuously since tracking began has no
 *   ``last_restock_at`` and shows nothing — see the backend's restock rule.)
 * - Out of stock but last in stock within ~30 days → ``last in stock 2d ago``.
 * - Otherwise → ``null`` (never-stocked, or the event is too old to matter). */
export function restockLabel(h: ListingHistory | undefined, now: Date): string | null {
  if (!h) return null;
  const ref = now.getTime();
  if (h.currently_in_stock) {
    if (!h.last_restock_at) return null;
    const age = ref - new Date(h.last_restock_at).getTime();
    if (!Number.isFinite(age) || age < 0 || age > RESTOCK_WINDOW_MS) return null;
    return `restocked ${ageLabel(age)} ago`;
  }
  if (!h.last_in_stock_at) return null;
  const age = ref - new Date(h.last_in_stock_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > LAST_STOCK_WINDOW_MS) return null;
  return `last in stock ${ageLabel(age)} ago`;
}

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
  if (manufacturer === "Loki Research") return "Loki";
  return manufacturer;
}

/** User-selectable motor-list orderings (the ``?order=`` URL param). "class" is
 * the default natural ordering (impulse class → diameter → designation). */
export type MotorOrder = "class" | "impulse" | "thrust" | "diameter" | "price";

const MOTOR_ORDERS: ReadonlySet<string> = new Set([
  "class",
  "impulse",
  "thrust",
  "diameter",
  "price",
]);

/** Parse the ``?order=`` param into a known MotorOrder, defaulting to "class". */
export function parseOrder(raw: string | string[] | undefined): MotorOrder {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && MOTOR_ORDERS.has(v) ? (v as MotorOrder) : "class";
}

/** Sort direction (the ``?dir=`` URL param), defaulting to ascending. */
export type SortDir = "asc" | "desc";

/** Parse the ``?dir=`` param, defaulting to "asc". */
export function parseDir(raw: string | string[] | undefined): SortDir {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "desc" ? "desc" : "asc";
}

/** Cheapest *in-stock* price (cents) across a motor's listings, or null when
 * nothing is in stock with a price. Used by the "price" ordering. */
export function cheapestInStockCents(m: Motor): number | null {
  let best: number | null = null;
  for (const l of m.listings) {
    if (!listingInStock(l.status) || l.price_cents == null) continue;
    if (best == null || l.price_cents < best) best = l.price_cents;
  }
  return best;
}

/** True when at least one of a motor's listings is in stock somewhere. */
export function motorInStock(m: Motor): boolean {
  return m.listings.some((l) => listingInStock(l.status));
}

// Tolerances for what counts as a usable substitute for a sold-out motor. A
// substitute must share the *exact* diameter (it has to fit the same mount) and
// impulse class (so a flyer rated for the original is rated for the swap), then
// land within these bands so the flight is comparable. Bands chosen from the
// live snapshot: tight enough that matches are genuinely interchangeable, loose
// enough that ~2/3 of sold-out motors get at least one in-stock alternative.
export const SUBSTITUTE_IMPULSE_BAND = 0.15; // ±15% total impulse
export const SUBSTITUTE_THRUST_BAND = 0.35; // ±35% average thrust (when known)

/** In-stock motors that can stand in for a sold-out ``target`` — same diameter
 * and impulse class, total impulse within ±15%, and (when both are known)
 * average thrust within ±35%. Ranked best-fit first: closest total impulse, then
 * closest thrust, then cheapest in-stock price, then designation.
 *
 * Returns ``[]`` when the target lacks the impulse/diameter data needed to judge
 * (we never guess a substitute we can't justify). The caller decides when to ask
 * — typically only for a motor that is out of stock everywhere. ``all`` should be
 * the full motor set, not the filtered view, so a swap isn't hidden by the
 * current filters. */
export function findSubstitutes(target: Motor, all: readonly Motor[]): Motor[] {
  const ti = target.total_impulse_ns;
  if (ti == null || ti <= 0) return [];
  const th = target.avg_thrust_n;

  const scored: { motor: Motor; score: number }[] = [];
  for (const c of all) {
    if (c.id === target.id) continue;
    if (c.diameter_mm !== target.diameter_mm) continue;
    if (c.impulse_class !== target.impulse_class) continue;
    if (!motorInStock(c)) continue;

    const cti = c.total_impulse_ns;
    if (cti == null) continue;
    const impulseDelta = Math.abs(cti - ti) / ti;
    if (impulseDelta > SUBSTITUTE_IMPULSE_BAND) continue;

    let thrustDelta: number;
    const cth = c.avg_thrust_n;
    if (th != null && th > 0 && cth != null) {
      thrustDelta = Math.abs(cth - th) / th;
      if (thrustDelta > SUBSTITUTE_THRUST_BAND) continue;
    } else {
      // Thrust unknown for one side: still a real fit on diameter + class +
      // impulse, so keep it — but score it as edge-of-band rather than a perfect
      // match, so a candidate with verified-close thrust outranks it on a tie.
      thrustDelta = SUBSTITUTE_THRUST_BAND;
    }

    // Impulse fit dominates; thrust is a secondary nudge.
    scored.push({ motor: c, score: impulseDelta + thrustDelta * 0.5 });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const pa = cheapestInStockCents(a.motor) ?? Number.POSITIVE_INFINITY;
    const pb = cheapestInStockCents(b.motor) ?? Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.motor.designation.localeCompare(b.motor.designation);
  });
  return scored.map((s) => s.motor);
}

/** The in-stock listing to point a flyer at for a substitute: the cheapest one
 * with a price, falling back to any in-stock listing when none is priced. */
export function cheapestInStockListing(m: Motor): Listing | null {
  let best: Listing | null = null;
  for (const l of m.listings) {
    if (!listingInStock(l.status) || l.price_cents == null) continue;
    if (best == null || l.price_cents < (best.price_cents as number)) best = l;
  }
  return best ?? m.listings.find((l) => listingInStock(l.status)) ?? null;
}

/** The compact, render-ready shape shipped to the client for one substitute —
 * just what the disclosure needs, so the server→client payload stays small and
 * doesn't carry every substitute's full listing array. */
export type Substitute = {
  manufacturer: string;
  designation: string;
  impulse_class: string;
  total_impulse_ns: number | null;
  avg_thrust_n: number | null;
  bestPriceCents: number | null;
  currency: string;
  vendorName: string | null;
  url: string | null;
};

/** Project a substitute Motor into the compact {@link Substitute} payload,
 * resolving the cheapest in-stock listing for the price/vendor/link. */
export function toSubstitute(m: Motor): Substitute {
  // One scan resolves the cheapest in-stock listing; its own price is the
  // cheapest in-stock price (or null when nothing is priced), so we read it
  // directly rather than re-deriving it with a second listings pass.
  const listing = cheapestInStockListing(m);
  return {
    manufacturer: m.manufacturer,
    designation: m.designation,
    impulse_class: m.impulse_class,
    total_impulse_ns: m.total_impulse_ns,
    avg_thrust_n: m.avg_thrust_n,
    bestPriceCents: listing?.price_cents ?? null,
    currency: listing?.currency ?? "USD",
    vendorName: listing?.vendor_name ?? null,
    url: listing?.url ?? null,
  };
}

// The label/value for single-use motors in the case filter — they need no
// reload hardware, so they're their own "case".
export const SINGLE_USE_CASE = "Single use";

/** The hardware a motor maps to for the case filter: its reload case (e.g.
 * "RMS-38/720", "Pro38-3G"), or the "Single use" pseudo-case for single-use
 * motors. ``null`` when unknown — a hybrid with no case, or a snapshot written
 * before case data existed — so such a motor matches no case selection. */
export function caseKey(m: Pick<Motor, "case_info" | "motor_type">): string | null {
  if (m.case_info) return m.case_info;
  if (m.motor_type === "SU") return SINGLE_USE_CASE;
  return null;
}

export type CaseOption = {
  value: string;
  diameter: number | null;
  // Brand label (e.g. "AeroTech", "Cesaroni"), shown muted in the filter — each
  // case belongs to one hardware family. null for Single use, which spans brands.
  manufacturer: string | null;
};

/** Distinct case options present in ``motors``, each with a representative
 * diameter (for grouping) and brand. Sorted by diameter then value, with Single
 * use last. Powers the searchable case filter. */
export function caseOptions(motors: readonly Motor[]): CaseOption[] {
  const meta = new Map<string, { diameter: number | null; manufacturer: string | null }>();
  for (const m of motors) {
    const k = caseKey(m);
    if (k == null || meta.has(k)) continue;
    meta.set(
      k,
      k === SINGLE_USE_CASE
        ? { diameter: null, manufacturer: null }
        : { diameter: m.diameter_mm, manufacturer: manufacturerLabel(m.manufacturer) },
    );
  }
  return Array.from(meta, ([value, m]) => ({ value, ...m })).sort((a, b) => {
    const ad = a.diameter ?? Number.POSITIVE_INFINITY;
    const bd = b.diameter ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.value.localeCompare(b.value);
  });
}

// Natural ordering: impulse class → diameter → designation.
function compareByClass(a: Motor, b: Motor): number {
  const [ac, ad, an] = rankMotor(a);
  const [bc, bd, bn] = rankMotor(b);
  if (ac !== bc) return ac.localeCompare(bc);
  if (ad !== bd) return ad - bd;
  return an.localeCompare(bn);
}

// Numeric sort keys for the non-"class" orderings.
const ORDER_KEYS: Record<
  Exclude<MotorOrder, "class">,
  (m: Motor) => number | null | undefined
> = {
  impulse: (m) => m.total_impulse_ns,
  thrust: (m) => m.avg_thrust_n,
  diameter: (m) => m.diameter_mm,
  price: cheapestInStockCents,
};

// Compare by a numeric key in the given direction. Motors missing the value
// (null/undefined) ALWAYS sort last regardless of direction — you don't want
// unpriced/spec-less motors floating to the top of a descending view. Ties fall
// back to the natural class ordering for stability.
function compareByKey(
  key: (m: Motor) => number | null | undefined,
  dir: SortDir,
): (a: Motor, b: Motor) => number {
  return (a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av == null && bv == null) return compareByClass(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return dir === "desc" ? bv - av : av - bv;
    return compareByClass(a, b);
  };
}

/** Sort motors for display by the chosen order and direction. Default
 * "class"/"asc": impulse class, then diameter, then designation. Numeric orders
 * put motors missing that value (e.g. no in-stock price) last in BOTH
 * directions; "desc" flips only the ordering among the motors that have it. */
export function sortedMotors(
  motors: Motor[],
  order: MotorOrder = "class",
  dir: SortDir = "asc",
): Motor[] {
  if (order === "class") {
    const cmp =
      dir === "desc"
        ? (a: Motor, b: Motor) => -compareByClass(a, b)
        : compareByClass;
    return [...motors].sort(cmp);
  }
  return [...motors].sort(compareByKey(ORDER_KEYS[order], dir));
}

/** Read a comma-separated multi-value query parameter into a Set. */
export function parseSetParam(v: string | string[] | undefined): Set<string> {
  if (!v) return new Set();
  const raw = Array.isArray(v) ? v.join(",") : v;
  return new Set(raw.split(",").filter(Boolean));
}

/** Normalize a free-text search input into the URL param value to store, or
 * ``null`` to drop the param. Trims; an empty result clears it. */
export function searchParamValue(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}

/** Normalize a numeric filter input into the URL param value to store, or
 * ``null`` to drop it (blank or non-numeric). Keeps the user's string form
 * (e.g. ``"2000"``) rather than reformatting. The single definition of "a
 * usable numeric filter value" on the URL-write side. */
export function numericParamValue(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  // Impulse is a non-negative quantity; drop blank, non-numeric, or negative
  // input (the `min={0}` on the inputs only constrains the spinner arrows).
  return Number.isFinite(n) && n >= 0 ? t : null;
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
