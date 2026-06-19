// Pure data-shaping helpers used by app/page.tsx. They take no React and
// no DOM, so they're trivially unit-testable and don't need a JSX runtime
// to exercise. If the table renders something garbled, the bug is almost
// always in here, not in the JSX.

import { packSize, unitPriceCents } from "./pack";
import type { CatalogListingHistory, Listing, Motor, UnmatchedListing } from "./snapshotTypes";

/** Lower bound on impulse class shown by the UI — D and up. Hides A/B/C
 * Estes-style model rocket motors that aren't this project's audience. */
export const MIN_CLASS = "D";

/** NAR/Tripoli certification ladder, by impulse class (which is itself a total-
 * impulse bracket). HPR certification is usually gated by impulse class
 * (L1 = H–I, L2 = J–L, L3 = M–O), but a motor below H is ALSO high-power — and
 * needs L1 — if its average thrust tops 80 N or it's sparky; see
 * {@link certRequirement}.
 * Lets a flyer filter to exactly what they're rated to buy and fly, and powers
 * the per-motor cert badge. Order matters: rendered as a ladder. */
export const CERT_LEVELS: ReadonlyArray<{
  key: string;
  label: string;
  sublabel: string;
  classes: readonly string[];
}> = [
  { key: "mid", label: "Mid-power", sublabel: "no cert", classes: ["D", "E", "F", "G"] },
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

// A motor BELOW the H impulse line is still a high-power motor (needs L1) when
// its average thrust tops 80 N, or it's sparky (spark-emitting) — the triggers
// vendors actually gate purchase certification on. Verified against CSRocketry's
// published "requires a L1 Certification to buy" flag, which fires for class H+,
// average thrust > 80 N, or sparky — but NOT for propellant mass alone, so we
// deliberately don't use NFPA's > 62.5 g propellant criterion here. Strict ">"
// 80 N so the classic "biggest motor you can fly uncertified" — a G80 like the
// Enerjet G80-7T — stays no-cert.
const HP_AVG_THRUST_N = 80;

/** The fields needed to decide a motor's cert requirement. Non-class fields are
 * optional so a bare ``{ impulse_class }`` (e.g. the explainer's example badge)
 * still type-checks. */
export type CertMotorInput = {
  impulse_class: string;
  avg_thrust_n?: number | null;
  sparky?: boolean | null;
};

export type CertInfo = { key: string; label: string; sublabel: string; reason?: string };

/** Why a sub-H motor is itself a "high-power motor" (so it needs L1) despite its
 * letter — or null if it doesn't. Triggers (vendor-enforced): average thrust
 * over 80 N, or sparky propellant. The returned string is shown to the flyer as
 * the reason. */
export function highPowerMotorReason(m: CertMotorInput): string | null {
  if (m.avg_thrust_n != null && m.avg_thrust_n > HP_AVG_THRUST_N)
    return `${Math.round(m.avg_thrust_n)} N average thrust (over ${HP_AVG_THRUST_N} N)`;
  if (m.sparky) return "spark-emitting (sparky) propellant";
  return null;
}

/** The HPR certification a motor REQUIRES to buy/fly, or null for none. Gated by
 * impulse class (L1 = H/I, L2 = J/L, L3 = M/O) plus average thrust and sparky: a
 * sub-H motor still requires L1 when its average thrust tops 80 N or it's sparky
 * (see {@link highPowerMotorReason}); ``reason`` explains that non-obvious case.
 * Matches what vendors gate certification on, so the filter and badge reflect
 * what a flyer actually needs to be certified for. */
export function certRequirement(m: CertMotorInput): CertInfo | null {
  const byClass = CLASS_TO_CERT.get(m.impulse_class);
  if (byClass && byClass.key !== "mid") return byClass; // H and up — by impulse class
  const reason = highPowerMotorReason(m);
  if (reason) {
    const l1 = CLASS_TO_CERT.get("H")!; // { key:"l1", label:"L1", sublabel:"H–I" }
    return { ...l1, reason };
  }
  return null;
}

/** The cert-filter bucket a motor belongs to: its required level (l1/l2/l3), or
 * "mid" when it needs no certification. */
export function certKey(m: CertMotorInput): string {
  return certRequirement(m)?.key ?? "mid";
}

// --- specific impulse (propellant efficiency) ------------------------------

const STANDARD_GRAVITY = 9.80665; // m/s²

// Plausible APCP specific-impulse band (seconds). Real hobby propellants land
// ~150–230s; values outside this come from a bad propellant-mass figure
// upstream, so we treat them as unknown rather than print a nonsense number.
export const ISP_MIN_PLAUSIBLE = 100;
export const ISP_MAX_PLAUSIBLE = 300;

/** Specific impulse (Isp, in seconds) = total impulse ÷ (propellant weight × g).
 * A propellant-efficiency figure: higher means more impulse per gram of grain.
 * Returns null when the inputs are missing/zero or the result is implausible
 * (so a bad upstream propellant mass never shows as a real-looking number). */
export function specificImpulseS(
  m: Pick<Motor, "total_impulse_ns" | "prop_weight_g">,
): number | null {
  const ti = m.total_impulse_ns;
  const pw = m.prop_weight_g;
  if (ti == null || ti <= 0 || pw == null || pw <= 0) return null;
  const isp = ti / ((pw / 1000) * STANDARD_GRAVITY);
  if (isp < ISP_MIN_PLAUSIBLE || isp > ISP_MAX_PLAUSIBLE) return null;
  return isp;
}

/** Format specific impulse for display. ``192.3`` → ``192 s``. */
export function formatIsp(isp: number | null): string {
  return isp == null ? "—" : `${Math.round(isp)} s`;
}

// --- burn character (how the motor burns) ----------------------------------

// Duration thresholds (seconds) splitting the catalog into a balanced three-way
// view: a quick punch, a standard burn, or a long sustained burn. Chosen from
// the live catalog distribution (≈25% / 38% / 37%).
export const BURN_PUNCHY_MAX_S = 1.5; // below this: short, snappy
export const BURN_LONG_MIN_S = 3.0; // at/above this: long, sustained

export type BurnCharacter = "punchy" | "standard" | "long";

/** Classify a motor's burn by duration: ``punchy`` (< 1.5 s), ``long`` (≥ 3 s),
 * or ``standard`` in between. Null when burn time is unknown. */
export function burnCharacter(m: Pick<Motor, "burn_time_s">): BurnCharacter | null {
  const b = m.burn_time_s;
  if (b == null || b <= 0) return null;
  if (b < BURN_PUNCHY_MAX_S) return "punchy";
  if (b >= BURN_LONG_MIN_S) return "long";
  return "standard";
}

/** Human label for each burn character. */
export const BURN_LABEL: Record<BurnCharacter, string> = {
  punchy: "Short burn",
  standard: "Standard burn",
  long: "Long burn",
};

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
// A storefront's "not for sale / price on request" placeholder is an absurd
// all-nines value — $99,999.99, $999,999.99. Hide only those. Real HPR motors
// run high but not THAT high: the very biggest (a Cesaroni Pro150 O-class, or an
// AeroTech 152mm O6000) genuinely list around $9,200–$9,999, so a $9,999.99 is a
// real price and must show. (Best-price + price sorting are in-stock-only and use
// the raw cents, so suppressing the *display* doesn't affect them.)
export function isSentinelPrice(cents: number | null): boolean {
  if (cents == null) return false;
  const dollars = Math.floor(cents / 100);
  return dollars >= 99999 && /^9+$/.test(String(dollars));
}

export function formatPrice(cents: number | null, currency: string): string {
  if (cents == null || isSentinelPrice(cents)) return "—";
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
export function restockLabel(h: CatalogListingHistory | undefined, now: Date): string | null {
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

/** Lowercase URL slug for a manufacturer — "aerotech" / "cesaroni" / "loki".
 * Derived from the display label so the detail-page URL matches what the user
 * sees, and stays stable as ThrustCurve's verbose names ("Cesaroni Technology")
 * change underneath. */
export function manufacturerSlug(manufacturer: string): string {
  return manufacturerLabel(manufacturer).toLowerCase();
}

// A handful of AeroTech designations contain a "/" (e.g. "F20W/L"), which can't
// live in a single URL path segment. "~" never appears in any designation, so we
// swap "/"↔"~" for the URL. Every other designation character (alnum . _ -) is
// URL-safe and passes through untouched.
export function designationToSlug(designation: string): string {
  return designation.replaceAll("/", "~");
}
export function designationFromSlug(slug: string): string {
  return slug.replaceAll("~", "/");
}

/** Internal detail-page path for a motor, e.g. "/motor/aerotech/J90W".
 * (manufacturer, designation) is unique across the catalog, so this is a stable,
 * human-readable permalink. */
export function motorPath(m: Pick<Motor, "manufacturer" | "designation">): string {
  return `/motor/${manufacturerSlug(m.manufacturer)}/${encodeURIComponent(
    designationToSlug(m.designation),
  )}`;
}

const SCHEMA_IN_STOCK = "https://schema.org/InStock";
const SCHEMA_OUT_OF_STOCK = "https://schema.org/OutOfStock";

/** schema.org Product + AggregateOffer JSON-LD for a motor's detail page, so
 * Google can surface price + availability in results (the core "is the J350 in
 * stock" intent). Uses only real prices — sentinel placeholders (>= the
 * formatPrice cutoff) and null prices are excluded so we never advertise a fake
 * number. `absoluteUrl` is the canonical detail-page URL. */
export function buildMotorJsonLd(m: Motor, absoluteUrl: string): Record<string, unknown> {
  const brand = manufacturerLabel(m.manufacturer);
  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${brand} ${m.designation}`,
    sku: m.designation,
    category: "Rocket motor",
    brand: { "@type": "Brand", name: brand },
    url: absoluteUrl,
  };

  // Structured-data prices are PER-MOTOR (pack-aware), matching the visible page
  // — the Product is one motor, so a multipack's per-unit price is the honest,
  // consistent figure (a raw pack price here would mismatch the page and mislead
  // rich results).
  const priced = m.listings
    .map((l) => ({ l, unit: unitPriceCents(l.price_cents, l) }))
    .filter(({ l, unit }) => unit != null && !isSentinelPrice(l.price_cents));
  if (priced.length > 0) {
    const cents = priced.map((p) => p.unit as number);
    const anyInStock = m.listings.some((l) => listingInStock(l.status));
    product.offers = {
      "@type": "AggregateOffer",
      priceCurrency: priced[0].l.currency,
      lowPrice: (Math.min(...cents) / 100).toFixed(2),
      highPrice: (Math.max(...cents) / 100).toFixed(2),
      // Count of the offers we actually list (real-priced) — kept consistent with
      // the `offers` array below rather than total listings, some of which have
      // no parseable price and so can't be a schema.org Offer.
      offerCount: priced.length,
      availability: anyInStock ? SCHEMA_IN_STOCK : SCHEMA_OUT_OF_STOCK,
      offers: priced.map(({ l, unit }) => ({
        "@type": "Offer",
        price: ((unit as number) / 100).toFixed(2),
        priceCurrency: l.currency,
        availability: listingInStock(l.status) ? SCHEMA_IN_STOCK : SCHEMA_OUT_OF_STOCK,
        url: safeHref(l.url),
        seller: { "@type": "Organization", name: l.vendor_name },
      })),
    };
  }
  return product;
}

/** User-selectable motor-list orderings (the ``?order=`` URL param). "class" is
 * the default natural ordering (impulse class → diameter → designation). */
export type MotorOrder = "class" | "impulse" | "thrust" | "diameter" | "price" | "isp";

const MOTOR_ORDERS: ReadonlySet<string> = new Set([
  "class",
  "impulse",
  "thrust",
  "diameter",
  "price",
  "isp",
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
 * nothing is in stock with a price. Used by the price filter and substitutes. */
export function cheapestInStockCents(m: Motor): number | null {
  let best: number | null = null;
  for (const l of m.listings) {
    if (!listingInStock(l.status)) continue;
    const unit = unitPriceCents(l.price_cents, l); // per-motor (pack-aware)
    if (unit == null) continue;
    if (best == null || unit < best) best = unit;
  }
  return best;
}

/** Cheapest per-unit price (cents) across ALL of a motor's listings regardless
 * of stock, or null when nothing is priced. Used by the "price" ordering; pair
 * it with the in-stock filter to rank by cheapest *available* price instead. */
export function cheapestCents(m: Motor): number | null {
  let best: number | null = null;
  for (const l of m.listings) {
    const unit = unitPriceCents(l.price_cents, l); // per-motor (pack-aware)
    if (unit == null) continue;
    if (best == null || unit < best) best = unit;
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
export const SUBSTITUTE_THRUST_BAND = 0.35; // ±35% average thrust (no-curve fallback)

// Curve-aware safety guards (applied when thrust-curve shape data is available
// for both motors). A swap must keep enough liftoff punch to clear the rail
// safely, and must not be dramatically punchier (which would pull more G's and
// fly very differently). Grounded in the ~5:1 thrust-to-weight / ~15 m/s
// rail-exit rule of thumb in high-power practice.
export const SUBSTITUTE_LIFTOFF_MIN = 0.7; // ≥70% of the original's initial (first-½s) thrust
export const SUBSTITUTE_PEAK_MAX = 1.6; // ≤160% of the original's peak thrust

/** Thrust-curve shape stats used to judge how *similarly* two motors fly:
 * ``peakN`` (max thrust → max-G), ``initialN`` (avg thrust over the first ½ s →
 * rail-exit/liftoff), and ``centroid`` (the impulse centroid as a fraction of
 * burn time: ~0 = front-loaded/regressive, ~1 = back-loaded/progressive, ~0.5 =
 * neutral). Keyed by ``"<manufacturer>|<designation>"`` and derived from the
 * thrust-curve sidecar; ``undefined`` when no curve is available. */
export type SubstituteShape = { peakN: number; initialN: number; centroid: number };

const shapeKey = (m: Pick<Motor, "manufacturer" | "designation">) =>
  `${m.manufacturer}|${m.designation}`;

/** In-stock motors that can stand in for a sold-out ``target`` — same diameter
 * and impulse class, total impulse within ±15%. When thrust-curve ``shapes`` are
 * provided, ranks by how similarly the swap will *fly* (impulse, then burn
 * shape, peak thrust, and liftoff thrust), and drops swaps that would be unsafe
 * off the rail (much weaker) or dramatically punchier (much higher peak). Without
 * shape data it falls back to the impulse + average-thrust (±35%) heuristic.
 * Ranked best-fit first, then cheapest in-stock price, then designation.
 *
 * Returns ``[]`` when the target lacks the impulse/diameter data needed to judge
 * (we never guess a substitute we can't justify). The caller decides when to ask
 * — typically only for a motor that is out of stock everywhere. ``all`` should be
 * the full motor set, not the filtered view, so a swap isn't hidden by the
 * current filters. */
export function findSubstitutes(
  target: Motor,
  all: readonly Motor[],
  shapes?: Record<string, SubstituteShape>,
): Motor[] {
  const ti = target.total_impulse_ns;
  if (ti == null || ti <= 0) return [];
  const th = target.avg_thrust_n;
  const tBurn = target.burn_time_s;
  const tShape = shapes?.[shapeKey(target)];

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

    const cShape = shapes?.[shapeKey(c)];

    if (tShape && cShape) {
      // Curve-aware "best flight match": guard rail-exit safety + over-punchiness,
      // then rank by how close the burn shape / peak / liftoff are.
      if (tShape.initialN > 0 && cShape.initialN < tShape.initialN * SUBSTITUTE_LIFTOFF_MIN)
        continue; // too weak off the rail
      if (tShape.peakN > 0 && cShape.peakN > tShape.peakN * SUBSTITUTE_PEAK_MAX) continue; // much punchier

      let score = impulseDelta;
      score += Math.abs(cShape.centroid - tShape.centroid) * 1.2; // progressive vs regressive
      if (tShape.peakN > 0) score += (Math.abs(cShape.peakN - tShape.peakN) / tShape.peakN) * 0.4;
      if (tShape.initialN > 0)
        score += (Math.abs(cShape.initialN - tShape.initialN) / tShape.initialN) * 0.4;
      if (tBurn != null && tBurn > 0 && c.burn_time_s != null)
        score += (Math.abs(c.burn_time_s - tBurn) / tBurn) * 0.4;
      scored.push({ motor: c, score });
    } else {
      // Fallback (no curve for one side): the original impulse + average-thrust
      // heuristic, so behavior is unchanged where shape data is unavailable.
      let thrustDelta: number;
      const cth = c.avg_thrust_n;
      if (th != null && th > 0 && cth != null) {
        thrustDelta = Math.abs(cth - th) / th;
        if (thrustDelta > SUBSTITUTE_THRUST_BAND) continue;
      } else {
        thrustDelta = SUBSTITUTE_THRUST_BAND;
      }
      scored.push({ motor: c, score: impulseDelta + thrustDelta * 0.5 });
    }
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
  let bestUnit = Number.POSITIVE_INFINITY;
  for (const l of m.listings) {
    if (!listingInStock(l.status)) continue;
    const unit = unitPriceCents(l.price_cents, l); // per-motor (pack-aware)
    if (unit == null) continue;
    if (unit < bestUnit) {
      best = l;
      bestUnit = unit;
    }
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
  // Resolved pack size of the chosen listing, so the "· N-pack" hint matches the
  // (pack-aware) bestPriceCents even when the size isn't in the URL.
  pack_size?: number;
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
    // Per-motor (pack-aware), to match the price shown everywhere else.
    bestPriceCents: listing ? unitPriceCents(listing.price_cents, listing) : null,
    currency: listing?.currency ?? "USD",
    vendorName: listing?.vendor_name ?? null,
    url: listing?.url ?? null,
    pack_size: listing ? packSize(listing) : undefined,
  };
}

// The label/value for single-use motors in the case filter — they need no
// reload hardware, so they're their own "case".
export const SINGLE_USE_CASE = "Single use";

/** The hardware a motor maps to for the case filter: the "Single use" pseudo-case
 * for any disposable (SU) motor, otherwise its reload case (e.g. "RMS-38/720",
 * "Pro38-3G"). Single use is checked FIRST because some disposable motors still
 * carry a case_info label that isn't reusable hardware — DMS ("Disposable Motor
 * System"), or a single-use form factor like "SU 24x95" — and those must group
 * under Single use, not as their own pseudo-case. ``null`` when unknown — a
 * hybrid with no case, or a snapshot written before case data existed. */
export function caseKey(m: Pick<Motor, "case_info" | "motor_type">): string | null {
  if (m.motor_type === "SU") return SINGLE_USE_CASE;
  if (m.case_info) return m.case_info;
  return null;
}

export type PropellantOption = {
  value: string; // the propellant name, e.g. "Blue Thunder"
  brand: string; // grouping label: the manufacturer, or "Other" if it spans brands
};

/** Distinct propellants present in ``motors``, each tagged with the brand that
 * makes it (for grouping in the searchable filter). A propellant used by more
 * than one manufacturer (e.g. "Classic") is grouped under "Other". Sorted by
 * brand then name, so groups read AeroTech → Cesaroni → Loki → Other. */
export function propellantOptions(motors: readonly Motor[]): PropellantOption[] {
  const brands = new Map<string, Set<string>>(); // propellant -> manufacturer labels
  for (const m of motors) {
    const p = m.propellant;
    if (!p) continue;
    const set = brands.get(p) ?? new Set<string>();
    set.add(manufacturerLabel(m.manufacturer));
    brands.set(p, set);
  }
  return Array.from(brands, ([value, mfrs]) => ({
    value,
    brand: mfrs.size === 1 ? [...mfrs][0] : "Other",
  })).sort((a, b) => (a.brand !== b.brand ? a.brand.localeCompare(b.brand) : a.value.localeCompare(b.value)));
}

export type VendorOption = {
  slug: string; // stable URL-filter value
  name: string; // display name, e.g. "Wildman Rocketry"
};

/** Distinct vendors that have at least one listing among ``motors``, sorted by
 * display name. Powers the vendor filter ("what does <vendor> carry"). */
export function vendorOptions(motors: readonly Motor[]): VendorOption[] {
  const names = new Map<string, string>(); // slug -> name
  for (const m of motors) {
    for (const l of m.listings) {
      if (l.vendor_slug && !names.has(l.vendor_slug)) names.set(l.vendor_slug, l.vendor_name);
    }
  }
  return Array.from(names, ([slug, name]) => ({ slug, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
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
  price: cheapestCents,
  isp: specificImpulseS,
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
  const base =
    order === "class"
      ? dir === "desc"
        ? (a: Motor, b: Motor) => -compareByClass(a, b)
        : compareByClass
      : compareByKey(ORDER_KEYS[order], dir);
  // "Phantom" motors (in the catalog but stocked by no tracked vendor — no
  // listings) always sink below real motors, so the buyable catalog comes first
  // and they form a clearly-separated tail. Real motors are unaffected.
  return [...motors].sort((a, b) => {
    const pa = a.listings.length === 0 ? 1 : 0;
    const pb = b.listings.length === 0 ? 1 : 0;
    return pa - pb || base(a, b);
  });
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

/** One unmatched designation and every vendor listing we found under it. */
export type UnmatchedGroup = {
  /** Display label — the shared raw designation, or the title when there's none. */
  designation: string;
  listings: UnmatchedListing[];
};

/** Collapse unmatched listings that share a raw designation into one group, so
 * the same motor sold by several vendors shows as a single entry instead of a
 * row per vendor. Listings with no parsed designation stay on their own (keyed by
 * URL) so they don't lump together. Groups keep first-seen order; within a group,
 * buyable listings come first, then cheapest by price. */
export function groupUnmatched(items: readonly UnmatchedListing[]): UnmatchedGroup[] {
  const groups = new Map<string, UnmatchedGroup>();
  for (const u of items) {
    const des = (u.raw_designation ?? "").trim();
    const key = des ? `d:${des.toLowerCase()}` : `u:${u.url}`;
    let g = groups.get(key);
    if (!g) {
      g = { designation: des || (u.raw_title ?? "").trim() || "—", listings: [] };
      groups.set(key, g);
    }
    g.listings.push(u);
  }
  for (const g of groups.values()) {
    g.listings.sort((a, b) => {
      const stock = Number(listingInStock(b.status)) - Number(listingInStock(a.status));
      if (stock !== 0) return stock;
      return (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity);
    });
  }
  return Array.from(groups.values());
}

/** The lowest in-stock price (in cents) among a set of listings for the *same*
 * variety, or ``null`` when there's nothing to highlight. Returns null unless
 * at least two in-stock listings carry a price — with zero or one, there's no
 * comparison to make, so flagging a "best price" would be noise. Compared at
 * the variety (delay-group) level rather than across a whole motor, since
 * different delays can be genuinely different products. */
export function bestInStockPriceCents(listings: Listing[]): number | null {
  const priced = listings
    .filter((l) => listingInStock(l.status))
    .map((l) => unitPriceCents(l.price_cents, l)) // per-motor (pack-aware)
    .filter((p): p is number => p != null);
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
    unitPriceCents(listing.price_cents, listing) === bestCents
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
    // Per-unit (pack-aware), to match the per-motor price the row displays.
    const ap = unitPriceCents(a.price_cents, a) ?? Number.POSITIVE_INFINITY;
    const bp = unitPriceCents(b.price_cents, b) ?? Number.POSITIVE_INFINITY;
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
      // In-stock first, then the chosen tiebreak; finally drop rows that would
      // render identically (de-dupe after sort so the kept one is the best-ranked).
      listings: dedupeRenderedListings(
        [...g.listings].sort((a, b) => {
          const ai = listingInStock(a.status) ? 0 : 1;
          const bi = listingInStock(b.status) ? 0 : 1;
          if (ai !== bi) return ai - bi;
          return listingTiebreak(a, b, sort);
        }),
      ),
    }))
    .sort((a, b) => a.delaySortKey - b.delaySortKey);
  return { ...motor, delayGroups };
}

/** Drop listings that would render as an identical row within a delay group —
 * same vendor, stock state, and price are the only visible columns. A few
 * vendors list the same motor twice (e.g. different pack sizes at the same
 * price), which otherwise shows as a confusing duplicate / double-count row. The
 * duplicates differ only by SKU/URL, so the first (best-ranked) one is kept. */
function dedupeRenderedListings(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  const out: Listing[] = [];
  for (const l of listings) {
    // Key on the VISIBLE columns (vendor name, stock state, per-unit price) —
    // that's what makes two rows indistinguishable. Per-unit, so a single and a
    // multipack at the same RAW price (different per-motor prices) aren't merged.
    const unit = unitPriceCents(l.price_cents, l);
    const key = `${l.vendor_name}|${l.status}|${l.stock_count ?? ""}|${l.lead_time ?? ""}|${unit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}
