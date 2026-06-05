import { describe, expect, it } from "vitest";

import { parseRockets, serializeRockets, type Rocket } from "./rockets";

// The localStorage / useSyncExternalStore glue is client-only and verified in
// the browser; these cover the pure parse/serialize logic the store is built on.

const ROCKET: Rocket = { id: "abc", name: "Punisher", diameterMm: 54, cert: "l2" };

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

  it("round-trips through serialize", () => {
    const rockets = [ROCKET, { id: "d2", name: "", diameterMm: 75, cert: "l3" }];
    expect(parseRockets(serializeRockets(rockets))).toEqual(rockets);
  });
});
