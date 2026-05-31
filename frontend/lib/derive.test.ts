import { describe, expect, it } from "vitest";

import {
  delayForRow,
  delaySortKey,
  extractDelay,
  formatPrice,
  groupByDelay,
  listingInStock,
  parseSetParam,
  rankMotor,
  sortedMotors,
  thrustcurveUrl,
} from "./derive";
import type { Listing, Motor } from "./snapshot";

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

  it("preserves the motor's identity fields on the grouped result", () => {
    const motor = makeMotor({ id: 42, designation: "X" });
    const g = groupByDelay({ ...motor, listings: [] });
    expect(g.id).toBe(42);
    expect(g.designation).toBe("X");
    expect(g.delayGroups).toEqual([]);
  });
});
