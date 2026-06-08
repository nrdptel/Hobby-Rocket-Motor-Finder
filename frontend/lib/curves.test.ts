import { describe, expect, it } from "vitest";

import { curveExtent, curveKey, curvePath, type ThrustCurve } from "./curves";

describe("curveKey", () => {
  it("joins manufacturer and designation, mirroring the backend", () => {
    expect(curveKey("AeroTech", "J90W")).toBe("AeroTech|J90W");
    expect(curveKey("Cesaroni Technology", "K530")).toBe("Cesaroni Technology|K530");
  });
});

describe("curveExtent", () => {
  it("returns the max time and thrust across all series", () => {
    const a: ThrustCurve = [
      [0, 0],
      [1, 50],
      [2, 0],
    ];
    const b: ThrustCurve = [
      [0, 0],
      [1.5, 80],
      [3, 0],
    ];
    expect(curveExtent([a, b])).toEqual({ maxT: 3, maxF: 80 });
  });

  it("is zero for empty input", () => {
    expect(curveExtent([])).toEqual({ maxT: 0, maxF: 0 });
  });
});

describe("curvePath", () => {
  const opts = { width: 100, height: 50, maxT: 2, maxF: 100 };

  it("maps points into the box with an inverted y-axis", () => {
    const pts: ThrustCurve = [
      [0, 0], // → x 0,   y 50 (bottom, zero thrust)
      [1, 100], // → x 50,  y 0  (top, peak thrust)
      [2, 0], // → x 100, y 50
    ];
    expect(curvePath(pts, opts)).toBe("M0.00 50.00 L50.00 0.00 L100.00 50.00");
  });

  it("returns '' for fewer than two points or a degenerate extent", () => {
    expect(curvePath([[0, 0]], opts)).toBe("");
    expect(curvePath([[0, 0], [1, 50]], { ...opts, maxT: 0 })).toBe("");
    expect(curvePath([[0, 0], [1, 50]], { ...opts, maxF: 0 })).toBe("");
  });
});
