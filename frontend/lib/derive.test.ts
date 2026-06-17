import { describe, expect, it } from "vitest";

import {
  SINGLE_USE_CASE,
  bestInStockPriceCents,
  caseKey,
  caseOptions,
  certClasses,
  certForClass,
  cheapestCents,
  cheapestInStockCents,
  cheapestInStockListing,
  delayForRow,
  delaySortKey,
  extractDelay,
  findSubstitutes,
  formatBurn,
  formatImpulse,
  formatPrice,
  isSentinelPrice,
  formatThrust,
  groupByDelay,
  groupUnmatched,
  isBestInStockPrice,
  buildMotorJsonLd,
  designationFromSlug,
  designationToSlug,
  listingInStock,
  manufacturerLabel,
  manufacturerSlug,
  motorInStock,
  motorPath,
  numericParamValue,
  parseDir,
  parseOrder,
  parseSetParam,
  propellantOptions,
  rankMotor,
  restockLabel,
  safeHref,
  searchParamValue,
  sortedMotors,
  staleLabel,
  thrustcurveUrl,
  vendorOptions,
  specificImpulseS,
  formatIsp,
  burnCharacter,
  BURN_LABEL,
} from "./derive";
import type { Listing, ListingHistory, Motor } from "./snapshot";

/** Minimal Motor builder for tests — overrides override the defaults. */
function makeMotor(overrides: Partial<Motor> = {}): Motor {
  return {
    id: 1,
    manufacturer: "AeroTech",
    designation: "H242T-14A",
    common_name: "H242",
    diameter_mm: 29,
    impulse_class: "H",
    total_impulse_ns: 237,
    avg_thrust_n: 242,
    burn_time_s: 0.98,
    propellant: "Blue Thunder",
    delays: "6,10,14",
    delay_adjustable: true,
    listings: [],
    ...overrides,
  };
}

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    vendor_slug: "csrocketry",
    vendor_name: "Chris' Rocket Supplies",
    url: "https://example.com/p/h242t",
    sku: null,
    raw_designation: "H242T-14A",
    price_cents: 4499,
    currency: "USD",
    status: "in_stock",
    stock_count: null,
    seen_at: "2026-05-31T12:00:00+00:00",
    ...overrides,
  };
}

// --- formatPrice -----------------------------------------------------------

describe("formatPrice", () => {
  it("renders integer cents as USD currency", () => {
    expect(formatPrice(4499, "USD")).toBe("$44.99");
  });

  it("rounds to currency precision", () => {
    expect(formatPrice(33140, "USD")).toBe("$331.40");
  });

  it("returns an em-dash for null", () => {
    expect(formatPrice(null, "USD")).toBe("—");
  });

  it("shows real big-motor prices, hiding only absurd all-nines placeholders", () => {
    // Real prices on the biggest motors (O-class) — all must show, including the
    // $9,999.99 that looks like a placeholder but is a genuine AeroTech O6000 price.
    expect(formatPrice(999999, "USD")).toBe("$9,999.99");
    expect(formatPrice(999900, "USD")).toBe("$9,999.00");
    expect(formatPrice(944199, "USD")).toBe("$9,441.99");
    expect(formatPrice(920200, "USD")).toBe("$9,202.00");
    expect(formatPrice(150000, "USD")).toBe("$1,500.00");
    // Only an absurd all-nines value is a "not for sale" placeholder.
    expect(formatPrice(9999999, "USD")).toBe("—"); // $99,999.99
  });

  it("isSentinelPrice flags only absurd all-nines placeholders", () => {
    expect(isSentinelPrice(9999999)).toBe(true); // $99,999.99
    expect(isSentinelPrice(99999999)).toBe(true); // $999,999.99
    expect(isSentinelPrice(999999)).toBe(false); // $9,999.99 — real (O-class)
    expect(isSentinelPrice(999900)).toBe(false); // $9,999.00 — real
    expect(isSentinelPrice(944199)).toBe(false); // $9,441.99 — real
    expect(isSentinelPrice(1000000)).toBe(false); // $10,000.00 — real
    expect(isSentinelPrice(null)).toBe(false);
  });

  it("falls back to a dollar string on an invalid scraped currency (no crash)", () => {
    // Intl.NumberFormat throws RangeError on a bad ISO code; a poisoned scraped
    // currency must not take down the whole SSR page.
    expect(formatPrice(4499, "")).toBe("$44.99");
    expect(formatPrice(4499, "<img>")).toBe("$44.99");
    expect(formatPrice(4499, "NOTACURRENCY")).toBe("$44.99");
  });
});

// --- safeHref --------------------------------------------------------------

describe("safeHref", () => {
  it("passes through http(s) URLs", () => {
    expect(safeHref("https://www.csrocketry.com/x")).toBe("https://www.csrocketry.com/x");
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });

  it("neutralizes non-http schemes and empties to '#'", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("data:text/html,<script>")).toBe("#");
    expect(safeHref("vbscript:msgbox")).toBe("#");
    expect(safeHref("")).toBe("#");
    expect(safeHref(null)).toBe("#");
    expect(safeHref(undefined)).toBe("#");
  });
});

// --- formatImpulse ---------------------------------------------------------

describe("formatImpulse", () => {
  it("rounds newton-seconds to a whole number with the unit", () => {
    expect(formatImpulse(237)).toBe("237 N·s");
    expect(formatImpulse(2479.6)).toBe("2480 N·s");
  });

  it("returns an em-dash for null", () => {
    expect(formatImpulse(null)).toBe("—");
  });
});

// --- formatThrust ----------------------------------------------------------

describe("formatThrust", () => {
  it("rounds newtons and appends the unit", () => {
    expect(formatThrust(242)).toBe("242 N");
    expect(formatThrust(241.7)).toBe("242 N");
  });

  it("returns an em-dash for null", () => {
    expect(formatThrust(null)).toBe("—");
  });
});

// --- formatBurn ------------------------------------------------------------

describe("formatBurn", () => {
  it("keeps two decimals for sub-second burns", () => {
    expect(formatBurn(0.98)).toBe("0.98 s");
    expect(formatBurn(0.3)).toBe("0.30 s");
  });

  it("rounds to one decimal for burns of a second or more", () => {
    expect(formatBurn(1.0)).toBe("1.0 s");
    expect(formatBurn(12.34)).toBe("12.3 s");
  });

  it("returns an em-dash for null", () => {
    expect(formatBurn(null)).toBe("—");
  });
});

// --- staleLabel ------------------------------------------------------------

describe("staleLabel", () => {
  const now = new Date("2026-06-03T12:00:00+00:00");

  it("returns null for data fresher than the 45-minute threshold", () => {
    // 30 minutes old — a single run's fresh listings span only ~15 min.
    expect(staleLabel("2026-06-03T11:30:00+00:00", now)).toBeNull();
    // Just under the threshold (44 min).
    expect(staleLabel("2026-06-03T11:16:00+00:00", now)).toBeNull();
    // Exactly at the snapshot moment.
    expect(staleLabel("2026-06-03T12:00:00+00:00", now)).toBeNull();
  });

  it("flags a single-cycle carry-forward (~75 min old)", () => {
    // The case the threshold exists to catch: a vendor carried forward for one
    // hourly cycle. ~65 min here rounds to 1h.
    expect(staleLabel("2026-06-03T10:55:00+00:00", now)).toBe("1h old");
    // 75 min still rounds to 1h.
    expect(staleLabel("2026-06-03T10:45:00+00:00", now)).toBe("1h old");
  });

  it("labels hours for stale-but-recent data", () => {
    expect(staleLabel("2026-06-03T09:00:00+00:00", now)).toBe("3h old");
    // 90 minutes rounds to 2h.
    expect(staleLabel("2026-06-03T10:30:00+00:00", now)).toBe("2h old");
  });

  it("labels days once past 24 hours", () => {
    expect(staleLabel("2026-06-01T12:00:00+00:00", now)).toBe("2d old");
    expect(staleLabel("2026-05-31T12:00:00+00:00", now)).toBe("3d old");
  });

  it("returns null for an unparseable seen_at rather than throwing", () => {
    expect(staleLabel("not-a-date", now)).toBeNull();
  });

  it("returns null when the reference time is unparseable", () => {
    // e.g. a snapshot whose generated_at is missing/malformed — don't render
    // a bogus 'NaNd old' badge on every listing.
    expect(staleLabel("2026-06-01T12:00:00+00:00", new Date("nonsense"))).toBeNull();
  });
});

// --- manufacturerLabel -----------------------------------------------------

describe("manufacturerLabel", () => {
  it("shortens the ThrustCurve Cesaroni name", () => {
    expect(manufacturerLabel("Cesaroni Technology")).toBe("Cesaroni");
  });

  it("passes other manufacturers through verbatim", () => {
    expect(manufacturerLabel("AeroTech")).toBe("AeroTech");
  });
});

// --- manufacturerSlug / motorPath ------------------------------------------

describe("manufacturerSlug / motorPath", () => {
  it("slugs the manufacturer to a lowercase label", () => {
    expect(manufacturerSlug("AeroTech")).toBe("aerotech");
    expect(manufacturerSlug("Cesaroni Technology")).toBe("cesaroni");
    expect(manufacturerSlug("Loki Research")).toBe("loki");
  });

  it("builds a stable detail-page path", () => {
    expect(motorPath(makeMotor({ manufacturer: "AeroTech", designation: "J90W" }))).toBe(
      "/motor/aerotech/J90W",
    );
    expect(
      motorPath(makeMotor({ manufacturer: "Cesaroni Technology", designation: "K530-IM" })),
    ).toBe("/motor/cesaroni/K530-IM");
  });

  it("builds Product + AggregateOffer JSON-LD, excluding sentinel/null prices", () => {
    const motor = makeMotor({
      manufacturer: "Cesaroni Technology",
      designation: "K530-IM",
      listings: [
        makeListing({ vendor_name: "Wildman", price_cents: 7499, status: "in_stock", currency: "USD" }),
        makeListing({ vendor_name: "Sirius", price_cents: 8100, status: "out_of_stock" }),
        makeListing({ vendor_name: "AeroTech-direct", price_cents: 9999999, status: "special_order" }), // $99,999.99 placeholder
        makeListing({ vendor_name: "Moto-Joe", price_cents: null, status: "out_of_stock" }), // no price
      ],
    });
    const ld = buildMotorJsonLd(motor, "https://motor.example/motor/cesaroni/K530-IM") as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Cesaroni K530-IM");
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Cesaroni" });
    expect(ld.url).toBe("https://motor.example/motor/cesaroni/K530-IM");
    const offers = ld.offers;
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers.lowPrice).toBe("74.99"); // cheapest real price
    expect(offers.highPrice).toBe("81.00"); // $99,999.99 placeholder excluded
    expect(offers.offerCount).toBe(2); // matches the real-priced offers array
    expect(offers.offers).toHaveLength(2); // only the two real-priced ones
    expect(offers.availability).toBe("https://schema.org/InStock"); // one is in stock
  });

  it("prices structured-data offers PER MOTOR (pack-aware), matching the page", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ vendor_name: "BRM", price_cents: 2100, status: "in_stock", url: "https://v/d13-3-pack" }), // $7/ea
        makeListing({ vendor_name: "Chris", price_cents: 2799, status: "in_stock", url: "https://v/d13-single" }),
      ],
    });
    const ld = buildMotorJsonLd(motor, "https://x/y") as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ld.offers.lowPrice).toBe("7.00"); // the 3-pack's per-unit, not $21.00
    expect(ld.offers.highPrice).toBe("27.99");
    expect(ld.offers.offers.map((o: { price: string }) => o.price).sort()).toEqual(["27.99", "7.00"]);
  });

  it("omits offers when no listing has a real price", () => {
    const motor = makeMotor({
      listings: [makeListing({ price_cents: null, status: "out_of_stock" })],
    });
    const ld = buildMotorJsonLd(motor, "https://x/y") as Record<string, unknown>;
    expect(ld["@type"]).toBe("Product");
    expect(ld.offers).toBeUndefined();
  });

  it("maps a slash-containing designation to a single safe segment", () => {
    // A few AeroTech designations carry a "/" (e.g. "F20W/L"); "/"→"~" keeps it
    // in one URL path segment, reversed on the detail page.
    expect(motorPath(makeMotor({ manufacturer: "AeroTech", designation: "F20W/L" }))).toBe(
      "/motor/aerotech/F20W~L",
    );
    expect(designationFromSlug("F20W~L")).toBe("F20W/L");
    expect(designationFromSlug(designationToSlug("F20W/L"))).toBe("F20W/L");
  });
});

// --- extractDelay ----------------------------------------------------------

describe("extractDelay", () => {
  it("pulls fixed-delay seconds", () => {
    expect(extractDelay("D13-10W")).toBe("10s");
    expect(extractDelay("F23-4FJ")).toBe("4s");
  });

  it("appends 'adj' when the suffix is -<n>A (adjustable)", () => {
    expect(extractDelay("H242T-14A")).toBe("14s adj");
    expect(extractDelay("K1000R-12A")).toBe("12s adj");
  });

  it("returns null when there is no delay token", () => {
    expect(extractDelay("M1500")).toBeNull();
    expect(extractDelay("H283ST")).toBeNull();
    expect(extractDelay("")).toBeNull();
  });
});

// --- delayForRow -----------------------------------------------------------

describe("delayForRow", () => {
  it("prefers the delay encoded in the vendor SKU", () => {
    const motor = makeMotor({ delays: "P", delay_adjustable: false });
    expect(delayForRow("H242T-14A", motor)).toBe("14s adj");
  });

  it("falls back to the motor's plug indicator when SKU has no delay", () => {
    const motor = makeMotor({ delays: "P", delay_adjustable: false });
    expect(delayForRow("M1500", motor)).toBe("plugged");
  });

  it("annotates multi-delay adjustable catalog motors", () => {
    const motor = makeMotor({ delays: "6,10,14", delay_adjustable: true });
    expect(delayForRow("M1500", motor)).toBe("6,10,14 adj");
  });

  it("annotates single-delay adjustable catalog motors", () => {
    const motor = makeMotor({ delays: "14", delay_adjustable: true });
    expect(delayForRow("M1500", motor)).toBe("14s adj");
  });

  it("renders fixed-delay catalog motors with an 's'", () => {
    const motor = makeMotor({ delays: "10", delay_adjustable: false });
    expect(delayForRow("M1500", motor)).toBe("10s");
  });

  it("returns an em-dash when neither SKU nor catalog has a delay", () => {
    const motor = makeMotor({ delays: null });
    expect(delayForRow("M1500", motor)).toBe("—");
  });
});

// --- certification mapping -------------------------------------------------

describe("certClasses", () => {
  it("expands selected cert keys to their impulse classes (union)", () => {
    expect([...certClasses(new Set(["l1"]))].sort()).toEqual(["H", "I"]);
    expect([...certClasses(new Set(["l2", "l3"]))].sort()).toEqual([
      "J", "K", "L", "M", "N", "O",
    ]);
    expect([...certClasses(new Set(["mid"]))].sort()).toEqual(["D", "E", "F", "G"]);
  });
  it("returns an empty set for no selection or unknown keys", () => {
    expect(certClasses(new Set()).size).toBe(0);
    expect(certClasses(new Set(["bogus"])).size).toBe(0);
  });
});

describe("certForClass", () => {
  it("maps HPR classes to their cert level", () => {
    expect(certForClass("H")?.label).toBe("L1");
    expect(certForClass("I")?.label).toBe("L1");
    expect(certForClass("K")?.label).toBe("L2");
    expect(certForClass("N")?.label).toBe("L3");
  });
  it("returns null for mid-power (no HPR cert) and unknown classes", () => {
    expect(certForClass("D")).toBeNull();
    expect(certForClass("G")).toBeNull();
    expect(certForClass("Z")).toBeNull();
  });
});

// --- rankMotor / sortedMotors ---------------------------------------------

describe("rankMotor + sortedMotors", () => {
  it("rankMotor returns class, diameter, designation tuple", () => {
    const m = makeMotor({ impulse_class: "H", diameter_mm: 29, designation: "H242T" });
    expect(rankMotor(m)).toEqual(["H", 29, "H242T"]);
  });

  it("sorts by impulse class first, then diameter, then designation", () => {
    const motors = [
      makeMotor({ id: 1, impulse_class: "H", diameter_mm: 38, designation: "H148R" }),
      makeMotor({ id: 2, impulse_class: "D", diameter_mm: 18, designation: "D13" }),
      makeMotor({ id: 3, impulse_class: "H", diameter_mm: 29, designation: "H242T" }),
      makeMotor({ id: 4, impulse_class: "H", diameter_mm: 29, designation: "H148R" }),
    ];
    const sorted = sortedMotors(motors);
    expect(sorted.map((m) => m.id)).toEqual([2, 4, 3, 1]);
  });

  it("does not mutate its input", () => {
    const motors = [
      makeMotor({ id: 1, impulse_class: "H" }),
      makeMotor({ id: 2, impulse_class: "D" }),
    ];
    const before = motors.map((m) => m.id);
    sortedMotors(motors);
    expect(motors.map((m) => m.id)).toEqual(before);
  });

  it("orders by total impulse ascending (nulls last) when order=impulse", () => {
    const motors = [
      makeMotor({ id: 1, total_impulse_ns: 900 }),
      makeMotor({ id: 2, total_impulse_ns: null }),
      makeMotor({ id: 3, total_impulse_ns: 120 }),
    ];
    expect(sortedMotors(motors, "impulse").map((m) => m.id)).toEqual([3, 1, 2]);
  });

  it("orders by diameter ascending when order=diameter", () => {
    const motors = [
      makeMotor({ id: 1, diameter_mm: 54 }),
      makeMotor({ id: 2, diameter_mm: 29 }),
      makeMotor({ id: 3, diameter_mm: 98 }),
    ];
    expect(sortedMotors(motors, "diameter").map((m) => m.id)).toEqual([2, 1, 3]);
  });

  it("reverses a numeric order with dir=desc but keeps nulls last", () => {
    const motors = [
      makeMotor({ id: 1, total_impulse_ns: 900 }),
      makeMotor({ id: 2, total_impulse_ns: null }),
      makeMotor({ id: 3, total_impulse_ns: 120 }),
    ];
    // desc among the valued ones (900 before 120), null still last.
    expect(sortedMotors(motors, "impulse", "desc").map((m) => m.id)).toEqual([1, 3, 2]);
  });

  it("reverses the class order with dir=desc", () => {
    const motors = [
      makeMotor({ id: 1, impulse_class: "D", diameter_mm: 18, designation: "D13" }),
      makeMotor({ id: 2, impulse_class: "H", diameter_mm: 29, designation: "H242T" }),
    ];
    expect(sortedMotors(motors, "class", "asc").map((m) => m.id)).toEqual([1, 2]);
    expect(sortedMotors(motors, "class", "desc").map((m) => m.id)).toEqual([2, 1]);
  });

  it("orders by cheapest price across all listings (stock-agnostic) when order=price", () => {
    const motors = [
      makeMotor({ id: 1, listings: [makeListing({ price_cents: 5000, status: "in_stock" })] }),
      // out of stock, but its price still counts for the price ordering — pair
      // with the in-stock filter if you only want what's buyable.
      makeMotor({ id: 2, listings: [makeListing({ price_cents: 1000, status: "out_of_stock" })] }),
      makeMotor({
        id: 3,
        listings: [
          makeListing({ price_cents: 9000, status: "in_stock" }),
          makeListing({ price_cents: 3000, status: "in_stock" }), // cheapest of its own
        ],
      }),
      // no priced listing → sorts last in both directions.
      makeMotor({ id: 4, listings: [makeListing({ price_cents: null, status: "in_stock" })] }),
    ];
    expect(sortedMotors(motors, "price").map((m) => m.id)).toEqual([2, 3, 1, 4]);
  });
});

// --- parseOrder / parseDir -------------------------------------------------

describe("parseOrder", () => {
  it("accepts known orders", () => {
    expect(parseOrder("impulse")).toBe("impulse");
    expect(parseOrder("price")).toBe("price");
  });
  it("defaults to class for unknown/absent", () => {
    expect(parseOrder(undefined)).toBe("class");
    expect(parseOrder("bogus")).toBe("class");
    expect(parseOrder(["impulse", "thrust"])).toBe("impulse"); // first wins
  });
});

describe("parseDir", () => {
  it("accepts desc, defaults to asc otherwise", () => {
    expect(parseDir("desc")).toBe("desc");
    expect(parseDir("asc")).toBe("asc");
    expect(parseDir(undefined)).toBe("asc");
    expect(parseDir("bogus")).toBe("asc");
  });
});

// --- cheapestInStockCents --------------------------------------------------

describe("cheapestInStockCents", () => {
  it("returns the cheapest in-stock priced listing", () => {
    const m = makeMotor({
      listings: [
        makeListing({ price_cents: 5000, status: "in_stock" }),
        makeListing({ price_cents: 3000, status: "in_stock_with_count" }),
        makeListing({ price_cents: 100, status: "out_of_stock" }), // ignored
      ],
    });
    expect(cheapestInStockCents(m)).toBe(3000);
  });
  it("returns null when nothing is in stock with a price", () => {
    const m = makeMotor({
      listings: [
        makeListing({ price_cents: 100, status: "out_of_stock" }),
        makeListing({ price_cents: null, status: "in_stock" }),
      ],
    });
    expect(cheapestInStockCents(m)).toBeNull();
  });
});

// --- cheapestCents (stock-agnostic) ----------------------------------------

describe("cheapestCents", () => {
  it("returns the cheapest priced listing regardless of stock", () => {
    const m = makeMotor({
      listings: [
        makeListing({ price_cents: 5000, status: "in_stock" }),
        makeListing({ price_cents: 1000, status: "out_of_stock" }), // counted
      ],
    });
    expect(cheapestCents(m)).toBe(1000);
  });
  it("returns null when no listing is priced", () => {
    const m = makeMotor({
      listings: [makeListing({ price_cents: null, status: "out_of_stock" })],
    });
    expect(cheapestCents(m)).toBeNull();
  });
});

describe("pack-aware pricing (per-unit comparison)", () => {
  const single = makeListing({ price_cents: 1200, status: "in_stock", url: "https://v/d13-single" });
  const pack3 = makeListing({ price_cents: 2100, status: "in_stock", url: "https://v/d13-3-pack" }); // $7/ea

  it("ranks a multipack by per-unit price, not the pack total", () => {
    // The $21 3-pack ($7/ea) is cheaper per motor than the $12 single, even
    // though $21 > $12.
    expect(cheapestInStockCents(makeMotor({ listings: [single, pack3] }))).toBe(700);
  });

  it("gives the 'best' marker to the per-unit-cheapest listing", () => {
    const best = bestInStockPriceCents([single, pack3]);
    expect(best).toBe(700);
    expect(isBestInStockPrice(pack3, best)).toBe(true);
    expect(isBestInStockPrice(single, best)).toBe(false);
  });

  it("cheapestInStockListing picks the per-unit-cheapest listing (the 3-pack)", () => {
    expect(cheapestInStockListing(makeMotor({ listings: [single, pack3] }))).toBe(pack3);
  });
});

// --- thrustcurveUrl --------------------------------------------------------

describe("thrustcurveUrl", () => {
  it("builds the canonical ThrustCurve link for a motor", () => {
    expect(thrustcurveUrl(makeMotor({ designation: "H242T-14A" }))).toBe(
      "https://www.thrustcurve.org/motors/AeroTech/H242T-14A/",
    );
  });

  it("URL-encodes manufacturers and designations with special characters", () => {
    // ThrustCurve's URLs treat dots and slashes literally; encodeURIComponent
    // handles forward slashes which would otherwise break path parsing.
    expect(thrustcurveUrl(makeMotor({ designation: "D2.3T" }))).toContain("D2.3T");
  });
});

// --- parseSetParam ---------------------------------------------------------

describe("parseSetParam", () => {
  it("returns empty Set for undefined", () => {
    expect(parseSetParam(undefined).size).toBe(0);
  });

  it("splits a comma-separated string", () => {
    expect(parseSetParam("H,I,J")).toEqual(new Set(["H", "I", "J"]));
  });

  it("joins arrays before splitting", () => {
    expect(parseSetParam(["H,I", "J"])).toEqual(new Set(["H", "I", "J"]));
  });

  it("drops empty fragments from trailing commas", () => {
    expect(parseSetParam("H,,I,")).toEqual(new Set(["H", "I"]));
  });
});

// --- searchParamValue ------------------------------------------------------

describe("searchParamValue", () => {
  it("trims and keeps non-empty input", () => {
    expect(searchParamValue("  H242 ")).toBe("H242");
  });

  it("returns null for blank/whitespace-only input", () => {
    expect(searchParamValue("")).toBeNull();
    expect(searchParamValue("   ")).toBeNull();
  });
});

// --- numericParamValue -----------------------------------------------------

describe("numericParamValue", () => {
  it("keeps a finite numeric string (trimmed, user's form preserved)", () => {
    expect(numericParamValue(" 2000 ")).toBe("2000");
    expect(numericParamValue("007")).toBe("007");
  });

  it("returns null for blank input", () => {
    expect(numericParamValue("")).toBeNull();
    expect(numericParamValue("  ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(numericParamValue("abc")).toBeNull();
    expect(numericParamValue("1e")).toBeNull();
  });

  it("rejects negative impulse values", () => {
    // Impulse is non-negative; a typed/pasted "-5" must not reach the URL.
    expect(numericParamValue("-5")).toBeNull();
    expect(numericParamValue("0")).toBe("0");
  });
});

// --- listingInStock --------------------------------------------------------

describe("listingInStock", () => {
  it("treats in_stock and in_stock_with_count as stocked", () => {
    expect(listingInStock("in_stock")).toBe(true);
    expect(listingInStock("in_stock_with_count")).toBe(true);
  });

  it("treats other statuses as not stocked", () => {
    for (const s of ["out_of_stock", "special_order", "unknown", "anything_else"]) {
      expect(listingInStock(s)).toBe(false);
    }
  });
});

// --- bestInStockPriceCents -------------------------------------------------

describe("bestInStockPriceCents", () => {
  it("returns the lowest in-stock price when two or more compete", () => {
    expect(
      bestInStockPriceCents([
        makeListing({ status: "in_stock", price_cents: 5500 }),
        makeListing({ status: "in_stock", price_cents: 3999 }),
        makeListing({ status: "in_stock", price_cents: 4499 }),
      ]),
    ).toBe(3999);
  });

  it("ignores out-of-stock listings even if they are cheaper", () => {
    expect(
      bestInStockPriceCents([
        makeListing({ status: "out_of_stock", price_cents: 1000 }),
        makeListing({ status: "in_stock", price_cents: 4499 }),
        makeListing({ status: "in_stock", price_cents: 3999 }),
      ]),
    ).toBe(3999);
  });

  it("returns null when fewer than two in-stock listings carry a price", () => {
    // Only one in-stock priced listing — no comparison to make.
    expect(
      bestInStockPriceCents([
        makeListing({ status: "in_stock", price_cents: 3999 }),
        makeListing({ status: "out_of_stock", price_cents: 2999 }),
      ]),
    ).toBeNull();
    // Two in-stock but one has no price.
    expect(
      bestInStockPriceCents([
        makeListing({ status: "in_stock", price_cents: 3999 }),
        makeListing({ status: "in_stock", price_cents: null }),
      ]),
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(bestInStockPriceCents([])).toBeNull();
  });
});

// --- isBestInStockPrice ----------------------------------------------------

describe("isBestInStockPrice", () => {
  it("flags an in-stock listing whose price ties the group minimum", () => {
    const l = makeListing({ status: "in_stock", price_cents: 3999 });
    expect(isBestInStockPrice(l, 3999)).toBe(true);
  });

  it("does not flag a listing priced above the minimum", () => {
    const l = makeListing({ status: "in_stock", price_cents: 5500 });
    expect(isBestInStockPrice(l, 3999)).toBe(false);
  });

  it("does not flag an out-of-stock listing even at the minimum price", () => {
    const l = makeListing({ status: "out_of_stock", price_cents: 3999 });
    expect(isBestInStockPrice(l, 3999)).toBe(false);
  });

  it("flags every in-stock listing tied at the minimum (ties allowed)", () => {
    const a = makeListing({ vendor_name: "A", status: "in_stock", price_cents: 3999 });
    const b = makeListing({ vendor_name: "B", status: "in_stock", price_cents: 3999 });
    expect(isBestInStockPrice(a, 3999)).toBe(true);
    expect(isBestInStockPrice(b, 3999)).toBe(true);
  });

  it("flags nothing when bestCents is null", () => {
    const l = makeListing({ status: "in_stock", price_cents: 3999 });
    expect(isBestInStockPrice(l, null)).toBe(false);
  });
});

// --- delaySortKey ----------------------------------------------------------

describe("delaySortKey", () => {
  it("places em-dash (unknown) last", () => {
    expect(delaySortKey("—")).toBe(Number.POSITIVE_INFINITY);
  });

  it("places plugged motors first", () => {
    expect(delaySortKey("plugged")).toBe(-1);
  });

  it("extracts a leading integer for numeric delays", () => {
    expect(delaySortKey("4s")).toBe(4);
    expect(delaySortKey("10s adj")).toBe(10);
    expect(delaySortKey("6,8,10,12,14 adj")).toBe(6);
  });

  it("falls back to infinity for unrecognized non-numeric forms", () => {
    expect(delaySortKey("weird")).toBe(Number.POSITIVE_INFINITY);
  });
});

// --- groupByDelay ----------------------------------------------------------

describe("groupByDelay", () => {
  it("groups listings sharing the same delay code", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Vendor B" }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Vendor A" }),
        makeListing({ raw_designation: "H242T-10A", vendor_name: "Vendor C" }),
      ],
    });
    const g = groupByDelay(motor);
    expect(g.delayGroups).toHaveLength(2);
    const fourteen = g.delayGroups.find((d) => d.delay === "14s adj");
    const ten = g.delayGroups.find((d) => d.delay === "10s adj");
    expect(fourteen?.listings).toHaveLength(2);
    expect(ten?.listings).toHaveLength(1);
  });

  const sirius = (over: Partial<Listing>): Listing =>
    makeListing({
      raw_designation: "H242T-14A",
      vendor_slug: "sirius",
      vendor_name: "Sirius",
      status: "in_stock",
      ...over,
    });

  it("de-dupes listings that would render identically (same vendor/status/per-unit price)", () => {
    // A vendor lists the same motor twice (variant SKUs at the same price) — same
    // delay, vendor, status and per-unit price, so they'd render as a confusing
    // duplicate row. Keep one. A genuinely different price stays a distinct row.
    const motor = makeMotor({
      listings: [
        sirius({ price_cents: 4499, url: "https://sirius.example/a" }),
        sirius({ price_cents: 4499, url: "https://sirius.example/b" }),
        sirius({ price_cents: 5999, url: "https://sirius.example/single" }),
      ],
    });
    const group = groupByDelay(motor).delayGroups.find((d) => d.delay === "14s adj");
    expect(group?.listings).toHaveLength(2); // two identical $44.99 rows collapsed
    expect(group?.listings.map((l) => l.price_cents).sort()).toEqual([4499, 5999]);
  });

  it("keeps a single and a multipack at the same RAW price (they differ per-unit)", () => {
    // $44.99 as a 3-pack is $15.00/ea — NOT the same row as a $44.99 single.
    const motor = makeMotor({
      listings: [
        sirius({ price_cents: 4499, url: "https://sirius.example/3pack" }),
        sirius({ price_cents: 4499, url: "https://sirius.example/single" }),
      ],
    });
    const group = groupByDelay(motor).delayGroups.find((d) => d.delay === "14s adj");
    expect(group?.listings).toHaveLength(2); // distinct per-unit prices → both kept
  });

  it("sorts delay groups by their numeric sort key (low → high)", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A" }),
        makeListing({ raw_designation: "H242T-6A" }),
        makeListing({ raw_designation: "H242T-10A" }),
      ],
    });
    const g = groupByDelay(motor);
    expect(g.delayGroups.map((d) => d.delay)).toEqual(["6s adj", "10s adj", "14s adj"]);
  });

  it("sorts listings within a group: in-stock first, then alphabetical vendor", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Z Vendor", status: "in_stock" }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "A Vendor", status: "out_of_stock" }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "B Vendor", status: "in_stock" }),
      ],
    });
    const g = groupByDelay(motor);
    const order = g.delayGroups[0].listings.map((l) => l.vendor_name);
    // in-stock pair first, alphabetical → B then Z; then out-of-stock A.
    expect(order).toEqual(["B Vendor", "Z Vendor", "A Vendor"]);
  });

  it("uses the first seen variety as the group's variety label", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A" }),
        makeListing({ raw_designation: "" }), // fallback would be motor.designation
      ],
    });
    const g = groupByDelay(motor);
    expect(g.delayGroups[0].variety).toBe("H242T-14A");
  });

  it("sorts in-stock listings cheapest-first in price mode, OOS still last", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Pricey", status: "in_stock", price_cents: 5500 }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Cheapest OOS", status: "out_of_stock", price_cents: 1000 }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Cheapest", status: "in_stock", price_cents: 3999 }),
      ],
    });
    const g = groupByDelay(motor, "price");
    // In-stock first (cheapest of those leading), out-of-stock last despite
    // being the lowest price overall.
    expect(g.delayGroups[0].listings.map((l) => l.vendor_name)).toEqual([
      "Cheapest",
      "Pricey",
      "Cheapest OOS",
    ]);
  });

  it("sorts price mode by PER-UNIT price (a cheaper-per-unit pack beats a single)", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Single", status: "in_stock", price_cents: 2000, url: "https://v/single" }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Pack", status: "in_stock", price_cents: 2100, url: "https://v/3-pack" }), // $7/ea
      ],
    });
    const g = groupByDelay(motor, "price");
    // $7/ea pack outranks the $20 single, even though its raw price is higher.
    expect(g.delayGroups[0].listings.map((l) => l.vendor_name)).toEqual(["Pack", "Single"]);
  });

  it("sends listings without a price to the end in price mode", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "No price", status: "in_stock", price_cents: null }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Has price", status: "in_stock", price_cents: 4999 }),
      ],
    });
    const g = groupByDelay(motor, "price");
    expect(g.delayGroups[0].listings.map((l) => l.vendor_name)).toEqual([
      "Has price",
      "No price",
    ]);
  });

  it("defaults to vendor-alphabetical tiebreak when no sort mode is given", () => {
    const motor = makeMotor({
      listings: [
        makeListing({ raw_designation: "H242T-14A", vendor_name: "Z Vendor", status: "in_stock", price_cents: 100 }),
        makeListing({ raw_designation: "H242T-14A", vendor_name: "A Vendor", status: "in_stock", price_cents: 9999 }),
      ],
    });
    const g = groupByDelay(motor);
    // Alphabetical, not cheapest-first.
    expect(g.delayGroups[0].listings.map((l) => l.vendor_name)).toEqual([
      "A Vendor",
      "Z Vendor",
    ]);
  });

  it("preserves the motor's identity fields on the grouped result", () => {
    const motor = makeMotor({ id: 42, designation: "X" });
    const g = groupByDelay({ ...motor, listings: [] });
    expect(g.id).toBe(42);
    expect(g.designation).toBe("X");
    expect(g.delayGroups).toEqual([]);
  });
});

/** Minimal ListingHistory builder for restockLabel tests. */
function makeHistory(overrides: Partial<ListingHistory> = {}): ListingHistory {
  return {
    currently_in_stock: true,
    status_current: "in_stock",
    first_seen_at: "2026-05-01T00:00:00+00:00",
    last_change_at: "2026-06-01T00:00:00+00:00",
    last_in_stock_at: "2026-06-01T00:00:00+00:00",
    last_restock_at: null,
    restock_count: 0,
    price_current_cents: 4499,
    price_prev_cents: null,
    price_low_cents: 4499,
    price_high_cents: 4499,
    ...overrides,
  };
}

describe("restockLabel", () => {
  const now = new Date("2026-06-04T12:00:00+00:00");

  it("returns null when there is no history for the listing", () => {
    expect(restockLabel(undefined, now)).toBeNull();
  });

  it("labels a recent restock on an in-stock listing", () => {
    const h = makeHistory({
      currently_in_stock: true,
      last_restock_at: "2026-06-04T09:00:00+00:00", // 3h before now
    });
    expect(restockLabel(h, now)).toBe("restocked 3h ago");
  });

  it("uses day granularity for older-but-in-window restocks", () => {
    const h = makeHistory({
      currently_in_stock: true,
      last_restock_at: "2026-06-02T12:00:00+00:00", // 2d before now
    });
    expect(restockLabel(h, now)).toBe("restocked 2d ago");
  });

  it("shows nothing for an in-stock listing with no genuine restock", () => {
    // Continuously in stock since tracking began → last_restock_at is null.
    const h = makeHistory({ currently_in_stock: true, last_restock_at: null });
    expect(restockLabel(h, now)).toBeNull();
  });

  it("shows nothing when the restock is older than the 14-day window", () => {
    const h = makeHistory({
      currently_in_stock: true,
      last_restock_at: "2026-05-01T12:00:00+00:00", // >14d before now
    });
    expect(restockLabel(h, now)).toBeNull();
  });

  it("labels when a now-out-of-stock listing was last in stock recently", () => {
    const h = makeHistory({
      currently_in_stock: false,
      last_in_stock_at: "2026-06-02T12:00:00+00:00", // 2d before now
    });
    expect(restockLabel(h, now)).toBe("last in stock 2d ago");
  });

  it("shows nothing for an out-of-stock listing never seen in stock", () => {
    const h = makeHistory({ currently_in_stock: false, last_in_stock_at: null });
    expect(restockLabel(h, now)).toBeNull();
  });

  it("shows nothing when last-in-stock is older than the 30-day window", () => {
    const h = makeHistory({
      currently_in_stock: false,
      last_in_stock_at: "2026-04-01T12:00:00+00:00", // >30d before now
    });
    expect(restockLabel(h, now)).toBeNull();
  });

  it("floors sub-hour ages at 1h rather than printing 0h", () => {
    const h = makeHistory({
      currently_in_stock: true,
      last_restock_at: "2026-06-04T11:45:00+00:00", // 15min before now
    });
    expect(restockLabel(h, now)).toBe("restocked 1h ago");
  });
});

// In-stock substitutes for a sold-out motor.
describe("findSubstitutes / motorInStock", () => {
  // A sold-out 29mm H-class target: 237 N·s, 242 N avg thrust.
  const target = makeMotor({
    id: 1,
    designation: "H242T-14A",
    diameter_mm: 29,
    impulse_class: "H",
    total_impulse_ns: 237,
    avg_thrust_n: 242,
    listings: [makeListing({ status: "out_of_stock" })],
  });

  const inStock = (over: Partial<Motor>) =>
    makeMotor({ listings: [makeListing({ status: "in_stock" })], ...over });

  it("motorInStock reflects whether any listing is in stock", () => {
    expect(motorInStock(target)).toBe(false);
    expect(motorInStock(inStock({ id: 9 }))).toBe(true);
  });

  it("returns in-stock motors that fit (same dia + class, impulse/thrust in band)", () => {
    const good = inStock({ id: 2, designation: "H250", total_impulse_ns: 250, avg_thrust_n: 250 });
    const subs = findSubstitutes(target, [target, good]);
    expect(subs.map((m) => m.id)).toEqual([2]);
  });

  it("excludes a different diameter (won't fit the mount) even if impulse matches", () => {
    const wrongDia = inStock({ id: 3, diameter_mm: 38, total_impulse_ns: 237, avg_thrust_n: 242 });
    expect(findSubstitutes(target, [target, wrongDia])).toEqual([]);
  });

  it("excludes a different impulse class (would need a higher cert)", () => {
    const wrongClass = inStock({ id: 4, impulse_class: "I", total_impulse_ns: 240, avg_thrust_n: 240 });
    expect(findSubstitutes(target, [target, wrongClass])).toEqual([]);
  });

  it("excludes out-of-stock candidates", () => {
    const oos = makeMotor({
      id: 5, total_impulse_ns: 240, avg_thrust_n: 240,
      listings: [makeListing({ status: "out_of_stock" })],
    });
    expect(findSubstitutes(target, [target, oos])).toEqual([]);
  });

  it("excludes total impulse beyond ±15%", () => {
    const tooBig = inStock({ id: 6, total_impulse_ns: 300, avg_thrust_n: 250 }); // +27%
    expect(findSubstitutes(target, [target, tooBig])).toEqual([]);
  });

  it("excludes average thrust beyond ±35% when both are known", () => {
    // Same impulse, but a very different (peaky) thrust profile.
    const peaky = inStock({ id: 7, total_impulse_ns: 240, avg_thrust_n: 400 }); // +65%
    expect(findSubstitutes(target, [target, peaky])).toEqual([]);
  });

  it("still matches on impulse when thrust data is missing", () => {
    const noThrust = inStock({ id: 8, total_impulse_ns: 240, avg_thrust_n: null });
    expect(findSubstitutes(target, [target, noThrust]).map((m) => m.id)).toEqual([8]);
  });

  it("ranks a verified-close-thrust candidate above an unknown-thrust one at equal impulse", () => {
    // Both 240 N·s (same impulse fit). One has thrust ~3% off; the other's thrust
    // is unknown — the verified-close one must win, not be tied as a perfect match.
    const known = inStock({ id: 20, designation: "H241", total_impulse_ns: 240, avg_thrust_n: 250 });
    const unknown = inStock({ id: 21, designation: "H241B", total_impulse_ns: 240, avg_thrust_n: null });
    const subs = findSubstitutes(target, [target, unknown, known]);
    expect(subs.map((m) => m.id)).toEqual([20, 21]);
  });

  it("ranks closest total impulse first, then cheapest", () => {
    const close = inStock({
      id: 10, designation: "H240", total_impulse_ns: 240, avg_thrust_n: 240,
      listings: [makeListing({ status: "in_stock", price_cents: 5000 })],
    });
    const farther = inStock({
      id: 11, designation: "H260", total_impulse_ns: 262, avg_thrust_n: 245,
      listings: [makeListing({ status: "in_stock", price_cents: 1000 })],
    });
    const subs = findSubstitutes(target, [target, farther, close]);
    expect(subs.map((m) => m.id)).toEqual([10, 11]); // closest impulse wins over cheaper
  });

  it("breaks ties on equal fit by cheapest in-stock price", () => {
    const a = inStock({
      id: 12, designation: "H230", total_impulse_ns: 230, avg_thrust_n: 242,
      listings: [makeListing({ status: "in_stock", price_cents: 6000 })],
    });
    const b = inStock({
      id: 13, designation: "H244", total_impulse_ns: 244, avg_thrust_n: 242,
      listings: [makeListing({ status: "in_stock", price_cents: 3000 })],
    });
    // |230-237|=7 and |244-237|=7 → equal impulse fit, same thrust → cheaper (b) first.
    const subs = findSubstitutes(target, [target, a, b]);
    expect(subs.map((m) => m.id)).toEqual([13, 12]);
  });

  it("returns [] when the target lacks impulse data (can't justify a swap)", () => {
    const noData = makeMotor({ id: 14, total_impulse_ns: null, listings: [makeListing({ status: "out_of_stock" })] });
    const good = inStock({ id: 15, total_impulse_ns: 240, avg_thrust_n: 240 });
    expect(findSubstitutes(noData, [noData, good])).toEqual([]);
  });
});

describe("findSubstitutes — curve-aware (best flight match)", () => {
  // A sold-out target with a front-loaded curve: strong off the pad, centroid 0.40.
  const target = makeMotor({
    id: 1,
    designation: "TGT",
    diameter_mm: 29,
    impulse_class: "H",
    total_impulse_ns: 237,
    listings: [makeListing({ status: "out_of_stock" })],
  });
  const cand = (id: number, designation: string) =>
    makeMotor({
      id,
      designation,
      diameter_mm: 29,
      impulse_class: "H",
      total_impulse_ns: 240, // within the ±15% band
      listings: [makeListing({ status: "in_stock" })],
    });

  // shapes keyed by "manufacturer|designation" (makeMotor uses "AeroTech").
  const shapes = {
    "AeroTech|TGT": { peakN: 400, initialN: 300, centroid: 0.4 },
    "AeroTech|CLOSE": { peakN: 390, initialN: 295, centroid: 0.42 }, // flies like TGT
    "AeroTech|FAR": { peakN: 390, initialN: 295, centroid: 0.75 }, // back-loaded, different
    "AeroTech|WEAK": { peakN: 390, initialN: 150, centroid: 0.42 }, // <70% liftoff → unsafe
    "AeroTech|PUNCHY": { peakN: 700, initialN: 295, centroid: 0.42 }, // >160% peak → much harder
  };

  it("ranks the closer burn-shape match first when impulse ties", () => {
    const subs = findSubstitutes(target, [target, cand(3, "FAR"), cand(2, "CLOSE")], shapes);
    expect(subs.map((m) => m.id)).toEqual([2, 3]); // CLOSE (centroid 0.42) over FAR (0.75)
  });

  it("drops a swap that's too weak off the rail (rail-exit safety)", () => {
    const subs = findSubstitutes(target, [target, cand(2, "CLOSE"), cand(4, "WEAK")], shapes);
    expect(subs.map((m) => m.id)).toEqual([2]); // WEAK excluded
  });

  it("drops a swap that's dramatically punchier (much higher peak thrust)", () => {
    const subs = findSubstitutes(target, [target, cand(2, "CLOSE"), cand(5, "PUNCHY")], shapes);
    expect(subs.map((m) => m.id)).toEqual([2]); // PUNCHY excluded
  });

  it("falls back to the impulse + avg-thrust heuristic when no shapes are given", () => {
    // Same candidates, but without a shapes map → the original behavior (both fit).
    const a = cand(2, "CLOSE");
    const b = cand(3, "FAR");
    expect(findSubstitutes(target, [target, a, b]).map((m) => m.id).sort()).toEqual([2, 3]);
  });
});

// Reload-case filter helpers.
describe("caseKey / caseOptions", () => {
  it("caseKey returns the reload case for a reload", () => {
    expect(caseKey(makeMotor({ motor_type: "reload", case_info: "RMS-38/720" }))).toBe("RMS-38/720");
  });

  it("caseKey returns 'Single use' for a single-use motor", () => {
    expect(caseKey(makeMotor({ motor_type: "SU", case_info: null }))).toBe(SINGLE_USE_CASE);
  });

  it("caseKey folds disposable motors that carry a case label into Single use", () => {
    // DMS ("Disposable Motor System") and single-use form factors like "SU 24x95"
    // are type SU but still have a non-reusable case_info — they must group under
    // Single use, not as their own pseudo-case.
    expect(caseKey(makeMotor({ motor_type: "SU", case_info: "DMS" }))).toBe(SINGLE_USE_CASE);
    expect(caseKey(makeMotor({ motor_type: "SU", case_info: "SU 24x95" }))).toBe(SINGLE_USE_CASE);
  });

  it("caseKey returns null when unknown (old snapshot, or hybrid w/o case)", () => {
    expect(caseKey(makeMotor({ motor_type: undefined, case_info: undefined }))).toBeNull();
    expect(caseKey(makeMotor({ motor_type: "hybrid", case_info: null }))).toBeNull();
  });

  it("caseOptions: distinct cases w/ diameter + brand, sorted by diameter then value, Single use last", () => {
    const motors = [
      makeMotor({ id: 1, manufacturer: "AeroTech", diameter_mm: 38, motor_type: "reload", case_info: "RMS-38/720" }),
      makeMotor({ id: 2, manufacturer: "AeroTech", diameter_mm: 38, motor_type: "reload", case_info: "RMS-38/720" }), // dup
      makeMotor({ id: 3, manufacturer: "Cesaroni Technology", diameter_mm: 29, motor_type: "reload", case_info: "Pro29-3G" }),
      makeMotor({ id: 4, manufacturer: "AeroTech", diameter_mm: 24, motor_type: "SU", case_info: null }),
      makeMotor({ id: 5, diameter_mm: 38, motor_type: undefined, case_info: undefined }), // no case → skipped
    ];
    expect(caseOptions(motors)).toEqual([
      { value: "Pro29-3G", diameter: 29, manufacturer: "Cesaroni" },
      { value: "RMS-38/720", diameter: 38, manufacturer: "AeroTech" },
      { value: SINGLE_USE_CASE, diameter: null, manufacturer: null },
    ]);
  });

  it("caseOptions folds a disposable motor's case label (DMS) into Single use, not a separate option", () => {
    const motors = [
      makeMotor({ id: 1, manufacturer: "AeroTech", diameter_mm: 38, motor_type: "reload", case_info: "RMS-38/720" }),
      makeMotor({ id: 2, manufacturer: "AeroTech", diameter_mm: 38, motor_type: "SU", case_info: "DMS" }),
      makeMotor({ id: 3, manufacturer: "AeroTech", diameter_mm: 24, motor_type: "SU", case_info: "SU 24x95" }),
    ];
    expect(caseOptions(motors).map((o) => o.value)).toEqual(["RMS-38/720", SINGLE_USE_CASE]);
  });
});

describe("propellantOptions", () => {
  it("dedupes, tags each by its brand, and sorts by brand then name", () => {
    const motors = [
      makeMotor({ id: 1, manufacturer: "AeroTech", propellant: "Blue Thunder" }),
      makeMotor({ id: 2, manufacturer: "AeroTech", propellant: "Blue Thunder" }), // dup
      makeMotor({ id: 3, manufacturer: "AeroTech", propellant: "White Lightning" }),
      makeMotor({ id: 4, manufacturer: "Cesaroni Technology", propellant: "Blue Streak" }),
      makeMotor({ id: 5, manufacturer: "Loki Research", propellant: "Loki White" }),
    ];
    expect(propellantOptions(motors)).toEqual([
      { value: "Blue Thunder", brand: "AeroTech" },
      { value: "White Lightning", brand: "AeroTech" },
      { value: "Blue Streak", brand: "Cesaroni" },
      { value: "Loki White", brand: "Loki" },
    ]);
  });

  it("groups a propellant used by more than one brand under 'Other'", () => {
    const motors = [
      makeMotor({ id: 1, manufacturer: "AeroTech", propellant: "Classic" }),
      makeMotor({ id: 2, manufacturer: "Cesaroni Technology", propellant: "Classic" }),
    ];
    expect(propellantOptions(motors)).toEqual([{ value: "Classic", brand: "Other" }]);
  });

  it("skips motors with no propellant", () => {
    const motors = [
      makeMotor({ id: 1, propellant: null }),
      makeMotor({ id: 2, manufacturer: "AeroTech", propellant: "Redline" }),
    ];
    expect(propellantOptions(motors)).toEqual([{ value: "Redline", brand: "AeroTech" }]);
  });
});

describe("vendorOptions", () => {
  it("collects distinct vendors across listings, sorted by display name", () => {
    const motors = [
      makeMotor({
        id: 1,
        listings: [
          makeListing({ vendor_slug: "wildman", vendor_name: "Wildman Rocketry" }),
          makeListing({ vendor_slug: "csrocketry", vendor_name: "Chris' Rocket Supplies" }),
        ],
      }),
      makeMotor({
        id: 2,
        listings: [
          makeListing({ vendor_slug: "wildman", vendor_name: "Wildman Rocketry" }), // dup
          makeListing({ vendor_slug: "sirius", vendor_name: "Sirius Rocketry" }),
        ],
      }),
    ];
    expect(vendorOptions(motors)).toEqual([
      { slug: "csrocketry", name: "Chris' Rocket Supplies" },
      { slug: "sirius", name: "Sirius Rocketry" },
      { slug: "wildman", name: "Wildman Rocketry" },
    ]);
  });

  it("returns [] when no motor has a listing", () => {
    expect(vendorOptions([makeMotor({ listings: [] })])).toEqual([]);
  });
});

describe("specificImpulseS", () => {
  it("computes Isp = total impulse / (prop weight × g)", () => {
    // 237 N·s over 130 g grain → 237 / (0.130 × 9.80665) ≈ 185.9 s
    const isp = specificImpulseS(makeMotor({ total_impulse_ns: 237, prop_weight_g: 130 }));
    expect(isp).toBeCloseTo(185.9, 0);
  });

  it("returns null when total impulse or prop weight is missing/zero", () => {
    expect(specificImpulseS(makeMotor({ total_impulse_ns: null, prop_weight_g: 130 }))).toBeNull();
    expect(specificImpulseS(makeMotor({ total_impulse_ns: 237, prop_weight_g: null }))).toBeNull();
    expect(specificImpulseS(makeMotor({ total_impulse_ns: 237, prop_weight_g: 0 }))).toBeNull();
  });

  it("guards an implausible result (bad upstream prop weight) by returning null", () => {
    // A grain weight far too small → absurdly high Isp → treated as unknown.
    expect(specificImpulseS(makeMotor({ total_impulse_ns: 5000, prop_weight_g: 1 }))).toBeNull();
    // ...and far too large → absurdly low Isp.
    expect(specificImpulseS(makeMotor({ total_impulse_ns: 100, prop_weight_g: 5000 }))).toBeNull();
  });

  it("formatIsp rounds to whole seconds, dash for null", () => {
    expect(formatIsp(185.9)).toBe("186 s");
    expect(formatIsp(null)).toBe("—");
  });
});

describe("burnCharacter", () => {
  it("classifies by burn duration", () => {
    expect(burnCharacter(makeMotor({ burn_time_s: 0.9 }))).toBe("punchy"); // < 1.5
    expect(burnCharacter(makeMotor({ burn_time_s: 1.5 }))).toBe("standard"); // boundary → standard
    expect(burnCharacter(makeMotor({ burn_time_s: 2.5 }))).toBe("standard");
    expect(burnCharacter(makeMotor({ burn_time_s: 3.0 }))).toBe("long"); // boundary → long
    expect(burnCharacter(makeMotor({ burn_time_s: 12 }))).toBe("long");
  });

  it("returns null when burn time is unknown or non-positive", () => {
    expect(burnCharacter(makeMotor({ burn_time_s: null }))).toBeNull();
    expect(burnCharacter(makeMotor({ burn_time_s: 0 }))).toBeNull();
  });

  it("has a label for every character", () => {
    expect(BURN_LABEL.punchy).toBe("Short burn");
    expect(BURN_LABEL.standard).toBe("Standard burn");
    expect(BURN_LABEL.long).toBe("Long burn");
  });
});

describe("sortedMotors — isp order", () => {
  it("orders by specific impulse, motors without Isp last", () => {
    const a = makeMotor({ id: 1, designation: "A", total_impulse_ns: 1000, prop_weight_g: 600 }); // ~170s
    const b = makeMotor({ id: 2, designation: "B", total_impulse_ns: 1000, prop_weight_g: 450 }); // ~226s
    const none = makeMotor({ id: 3, designation: "C", total_impulse_ns: 1000, prop_weight_g: null });
    const asc = sortedMotors([none, b, a], "isp", "asc").map((m) => m.id);
    expect(asc[0]).toBe(1); // lower Isp first
    expect(asc[1]).toBe(2);
    expect(asc[2]).toBe(3); // unknown Isp sinks last
  });
});

// --- groupUnmatched --------------------------------------------------------
describe("groupUnmatched", () => {
  const u = (over: Partial<Parameters<typeof groupUnmatched>[0][number]>) => ({
    raw_designation: "",
    raw_title: "",
    vendor_slug: "v",
    vendor_name: "Vendor",
    url: `https://example.com/${Math.random()}`,
    sku: null,
    price_cents: null,
    currency: "USD",
    status: "out_of_stock" as const,
    stock_count: null,
    seen_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("collapses same-designation listings into one group", () => {
    const groups = groupUnmatched([
      u({ raw_designation: "I297", vendor_name: "A", url: "a" }),
      u({ raw_designation: "O5280X-PS", vendor_name: "B", url: "b" }),
      u({ raw_designation: "I297", vendor_name: "C", url: "c" }),
    ]);
    expect(groups.map((g) => g.designation)).toEqual(["I297", "O5280X-PS"]);
    expect(groups[0].listings.map((l) => l.vendor_name)).toEqual(["A", "C"]);
    expect(groups[1].listings).toHaveLength(1);
  });

  it("groups case-insensitively but keeps the first-seen label", () => {
    const groups = groupUnmatched([
      u({ raw_designation: "I297", url: "a" }),
      u({ raw_designation: "i297", url: "b" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].designation).toBe("I297");
  });

  it("orders listings buyable-first, then cheapest", () => {
    const groups = groupUnmatched([
      u({ raw_designation: "X", url: "a", status: "out_of_stock", price_cents: 100 }),
      u({ raw_designation: "X", url: "b", status: "in_stock", price_cents: 900 }),
      u({ raw_designation: "X", url: "c", status: "in_stock", price_cents: 500 }),
    ]);
    expect(groups[0].listings.map((l) => l.url)).toEqual(["c", "b", "a"]);
  });

  it("keeps listings with no designation separate (one group each)", () => {
    const groups = groupUnmatched([
      u({ raw_designation: "", raw_title: "Mystery A", url: "a" }),
      u({ raw_designation: "", raw_title: "Mystery B", url: "b" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.designation)).toEqual(["Mystery A", "Mystery B"]);
  });
});
