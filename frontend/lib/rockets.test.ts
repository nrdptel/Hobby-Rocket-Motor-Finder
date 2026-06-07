import { describe, expect, it } from "vitest";

import {
  motorFitsRocket,
  parseRockets,
  rocketInStockCount,
  rocketMatchesParams,
  serializeRockets,
  type Rocket,
  type RocketMotor,
  type RocketSpec,
} from "./rockets";

// The localStorage / useSyncExternalStore glue is client-only and verified in
// the browser; these cover the pure parse/serialize logic the store is built on.

const ROCKET: Rocket = {
  id: "abc",
  name: "Punisher",
  diameterMm: 54,
  cert: "l2",
  impulseClass: null,
  caseInfo: null,
  minImpulseNs: 1000,
  maxImpulseNs: 2560,
};

describe("parseRockets", () => {
  it("parses a JSON array of rockets", () => {
    expect(parseRockets(JSON.stringify([ROCKET]))).toEqual([ROCKET]);
  });

  it("round-trips a rocket with class + case", () => {
    const r: Rocket = {
      id: "j",
      name: "",
      diameterMm: 54,
      cert: null,
      impulseClass: "J",
      caseInfo: "RMS-54/1706",
      minImpulseNs: null,
      maxImpulseNs: null,
    };
    expect(parseRockets(serializeRockets([r]))).toEqual([r]);
  });

  it("returns [] for null/empty (nothing saved yet)", () => {
    expect(parseRockets(null)).toEqual([]);
    expect(parseRockets("")).toEqual([]);
  });

  it("returns [] for malformed JSON or a non-array rather than throwing", () => {
    expect(parseRockets("{not json")).toEqual([]);
    expect(parseRockets('{"a":1}')).toEqual([]);
    expect(parseRockets("42")).toEqual([]);
  });

  it("drops only entries missing a valid diameter (cert is optional)", () => {
    const raw = JSON.stringify([
      ROCKET,
      { id: "x", diameterMm: "54", cert: "l1" }, // diameter not a number → dropped
      { id: "z", cert: "l1" }, // no diameter → dropped
      null,
      "nope",
    ]);
    expect(parseRockets(raw)).toEqual([ROCKET]);
  });

  it("keeps a diameter-only rocket (cert/class/case all null)", () => {
    const raw = JSON.stringify([{ id: "y", diameterMm: 38 }]);
    const [r] = parseRockets(raw);
    expect(r.diameterMm).toBe(38);
    expect(r.cert).toBeNull();
    expect(r.impulseClass).toBeNull();
    expect(r.caseInfo).toBeNull();
  });

  it("fills defaults for a missing id/name", () => {
    const raw = JSON.stringify([{ diameterMm: 38, cert: "l1" }]);
    const [r] = parseRockets(raw);
    expect(r.diameterMm).toBe(38);
    expect(r.cert).toBe("l1");
    expect(typeof r.id).toBe("string");
    expect(r.id.length).toBeGreaterThan(0);
    expect(r.name).toBe("");
  });

  it("defaults class/case/band to null for rockets saved before those fields (back-compat)", () => {
    const raw = JSON.stringify([{ id: "old", name: "Legacy", diameterMm: 38, cert: "l1" }]);
    const [r] = parseRockets(raw);
    expect(r.impulseClass).toBeNull();
    expect(r.caseInfo).toBeNull();
    expect(r.minImpulseNs).toBeNull();
    expect(r.maxImpulseNs).toBeNull();
  });

  it("parses and coerces an invalid impulse bound to null", () => {
    const raw = JSON.stringify([
      { id: "a", name: "", diameterMm: 54, cert: "l2", minImpulseNs: 1000, maxImpulseNs: "x" },
    ]);
    const [r] = parseRockets(raw);
    expect(r.minImpulseNs).toBe(1000);
    expect(r.maxImpulseNs).toBeNull();
  });

  it("round-trips through serialize", () => {
    const rockets: Rocket[] = [
      ROCKET,
      {
        id: "d2",
        name: "",
        diameterMm: 75,
        cert: "l3",
        impulseClass: null,
        caseInfo: null,
        minImpulseNs: null,
        maxImpulseNs: null,
      },
    ];
    expect(parseRockets(serializeRockets(rockets))).toEqual(rockets);
  });
});

// --- motorFitsRocket / rocketInStockCount ----------------------------------

const m = (
  diameter_mm: number,
  impulse_class: string,
  total_impulse_ns: number | null,
  inStock = true,
): RocketMotor => ({ diameter_mm, impulse_class, total_impulse_ns, inStock });

const spec = (over: Partial<RocketSpec>): RocketSpec => ({
  diameterMm: 54,
  cert: null,
  impulseClass: null,
  caseInfo: null,
  minImpulseNs: null,
  maxImpulseNs: null,
  ...over,
});

describe("motorFitsRocket", () => {
  const r54L2 = spec({ cert: "l2" });

  it("matches by diameter + cert's impulse classes", () => {
    expect(motorFitsRocket(r54L2, m(54, "J", 800))).toBe(true); // J ∈ L2
    expect(motorFitsRocket(r54L2, m(54, "H", 200))).toBe(false); // H ∉ L2
    expect(motorFitsRocket(r54L2, m(38, "K", 1500))).toBe(false); // wrong diameter
  });

  it("matches a diameter-only rocket against any class at that diameter", () => {
    const r = spec({});
    expect(motorFitsRocket(r, m(54, "H", 200))).toBe(true);
    expect(motorFitsRocket(r, m(54, "M", 8000))).toBe(true);
    expect(motorFitsRocket(r, m(38, "H", 200))).toBe(false);
  });

  it("narrows by a single impulse class when set", () => {
    const r = spec({ impulseClass: "J" });
    expect(motorFitsRocket(r, m(54, "J", 1200))).toBe(true);
    expect(motorFitsRocket(r, m(54, "K", 1600))).toBe(false);
  });

  it("narrows by reload case when set (via caseKey)", () => {
    const r = spec({ caseInfo: "RMS-54/1706" });
    const fits = {
      diameter_mm: 54,
      impulse_class: "J",
      total_impulse_ns: 1700,
      case_info: "RMS-54/1706",
      motor_type: "reload",
    };
    expect(motorFitsRocket(r, fits)).toBe(true);
    expect(motorFitsRocket(r, { ...fits, case_info: "RMS-54/852" })).toBe(false);
  });

  it("respects the impulse band when set (nulls excluded)", () => {
    const banded = spec({ cert: "l2", minImpulseNs: 1000, maxImpulseNs: 2560 });
    expect(motorFitsRocket(banded, m(54, "K", 1500))).toBe(true);
    expect(motorFitsRocket(banded, m(54, "J", 800))).toBe(false); // below min
    expect(motorFitsRocket(banded, m(54, "L", 3000))).toBe(false); // above max
    expect(motorFitsRocket(banded, m(54, "K", null))).toBe(false); // no impulse value
  });
});

describe("rocketMatchesParams", () => {
  // A param getter backed by a plain map (null = absent), like URLSearchParams.get.
  const getter = (m: Record<string, string>) => (k: string) => m[k] ?? null;

  it("matches when every param exactly describes the rocket", () => {
    const get = getter({ dia: "54", cert: "l2", imin: "1000", imax: "2560" });
    expect(rocketMatchesParams(ROCKET, get)).toBe(true);
  });

  it("requires unset rocket fields to be ABSENT from the params", () => {
    // ROCKET has no impulseClass; a class param present means it's not this rocket.
    const get = getter({ dia: "54", cert: "l2", imin: "1000", imax: "2560", class: "K" });
    expect(rocketMatchesParams(ROCKET, get)).toBe(false);
  });

  it("fails when a set field differs or is missing", () => {
    expect(rocketMatchesParams(ROCKET, getter({ dia: "38", cert: "l2", imin: "1000", imax: "2560" }))).toBe(false);
    expect(rocketMatchesParams(ROCKET, getter({ dia: "54", cert: "l2", imin: "1000" }))).toBe(false);
  });

  it("matches a diameter-only rocket only when no other rocket params are set", () => {
    const diaOnly: Rocket = { ...ROCKET, cert: null, minImpulseNs: null, maxImpulseNs: null };
    expect(rocketMatchesParams(diaOnly, getter({ dia: "54" }))).toBe(true);
    expect(rocketMatchesParams(diaOnly, getter({ dia: "54", cert: "l2" }))).toBe(false);
  });
});

describe("rocketInStockCount", () => {
  it("counts only in-stock motors that fit", () => {
    const rocket = spec({ cert: "l2" });
    const motors = [
      m(54, "J", 800, true), // fits, in stock ✓
      m(54, "K", 1500, true), // fits, in stock ✓
      m(54, "K", 1600, false), // fits but OUT of stock ✗
      m(54, "H", 200, true), // wrong cert ✗
      m(38, "J", 800, true), // wrong diameter ✗
    ];
    expect(rocketInStockCount(rocket, motors)).toBe(2);
  });
});
