import { describe, expect, it } from "vitest";

import { parseScroll } from "./catalogSession";

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
