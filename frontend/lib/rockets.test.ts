import { describe, expect, it } from "vitest";

import {
  motorFitsRocket,
  parseRockets,
  rocketInStockCount,
  serializeRockets,
  type Rocket,
  type RocketMotor,
} from "./rockets";

// The localStorage / useSyncExternalStore glue is client-only and verified in
// the browser; these cover the pure parse/serialize logic the store is built on.

const ROCKET: Rocket = {
  id: "abc",
  name: "Punisher",
  diameterMm: 54,
  cert: "l2",
  minImpulseNs: 1000,
  maxImpulseNs: 2560,
};

describe("parseRockets", () => {
  it("parses a JSON array of rockets", () => {
    expect(parseRockets(JSON.stringify([ROCKET]))).toEqual([ROCKET]);
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

  it("drops entries missing a valid diameter or cert", () => {
    const raw = JSON.stringify([
      ROCKET,
      { id: "x", diameterMm: "54", cert: "l1" }, // diameter not a number
      { id: "y", diameterMm: 38 }, // no cert
      { id: "z", cert: "l1" }, // no diameter
      null,
      "nope",
    ]);
    expect(parseRockets(raw)).toEqual([ROCKET]);
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

  it("defaults the impulse band to null for rockets saved before that field (back-compat)", () => {
    const raw = JSON.stringify([{ id: "old", name: "Legacy", diameterMm: 38, cert: "l1" }]);
    const [r] = parseRockets(raw);
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
    const rockets = [
      ROCKET,
      { id: "d2", name: "", diameterMm: 75, cert: "l3", minImpulseNs: null, maxImpulseNs: null },
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

describe("motorFitsRocket", () => {
  const r54L2 = { diameterMm: 54, cert: "l2", minImpulseNs: null, maxImpulseNs: null };

  it("matches by diameter + cert's impulse classes", () => {
    expect(motorFitsRocket(r54L2, m(54, "J", 800))).toBe(true); // J ∈ L2
    expect(motorFitsRocket(r54L2, m(54, "H", 200))).toBe(false); // H ∉ L2
    expect(motorFitsRocket(r54L2, m(38, "K", 1500))).toBe(false); // wrong diameter
  });

  it("respects the impulse band when set (nulls excluded)", () => {
    const banded = { diameterMm: 54, cert: "l2", minImpulseNs: 1000, maxImpulseNs: 2560 };
    expect(motorFitsRocket(banded, m(54, "K", 1500))).toBe(true);
    expect(motorFitsRocket(banded, m(54, "J", 800))).toBe(false); // below min
    expect(motorFitsRocket(banded, m(54, "L", 3000))).toBe(false); // above max
    expect(motorFitsRocket(banded, m(54, "K", null))).toBe(false); // no impulse value
  });
});

describe("rocketInStockCount", () => {
  it("counts only in-stock motors that fit", () => {
    const rocket = { diameterMm: 54, cert: "l2", minImpulseNs: null, maxImpulseNs: null };
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
