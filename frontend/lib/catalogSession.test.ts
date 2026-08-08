import { describe, expect, it } from "vitest";

import { parseOpenSwaps, parseScroll } from "./catalogSession";

describe("parseScroll", () => {
  it("returns 0 for absent or empty input", () => {
    expect(parseScroll(null)).toBe(0);
    expect(parseScroll("")).toBe(0);
  });

  it("returns 0 for non-numeric or non-positive values", () => {
    expect(parseScroll("nope")).toBe(0);
    expect(parseScroll("0")).toBe(0);
    expect(parseScroll("-120")).toBe(0);
    expect(parseScroll("NaN")).toBe(0);
    expect(parseScroll("Infinity")).toBe(0);
  });

  it("parses a positive pixel offset", () => {
    expect(parseScroll("2500")).toBe(2500);
    expect(parseScroll("12.7")).toBe(12.7);
  });
});

describe("parseOpenSwaps", () => {
  it("returns [] for absent, empty, or malformed input", () => {
    expect(parseOpenSwaps(null)).toEqual([]);
    expect(parseOpenSwaps("")).toEqual([]);
    expect(parseOpenSwaps("{oops")).toEqual([]);
    // Valid JSON, wrong shape — an older/other writer's value must not throw.
    expect(parseOpenSwaps('{"a":1}')).toEqual([]);
    expect(parseOpenSwaps('"364"')).toEqual([]);
  });

  it("parses a list of motor ids", () => {
    expect(parseOpenSwaps("[]")).toEqual([]);
    expect(parseOpenSwaps("[364,366,370]")).toEqual([364, 366, 370]);
  });

  it("drops non-numeric and non-finite entries rather than the whole list", () => {
    expect(parseOpenSwaps('[364,"366",null,370]')).toEqual([364, 370]);
    // JSON has no Infinity/NaN literal; they arrive as null and are dropped.
    expect(parseOpenSwaps("[null,364]")).toEqual([364]);
  });
});
