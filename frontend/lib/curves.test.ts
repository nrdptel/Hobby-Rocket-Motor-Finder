import { describe, expect, it } from "vitest";

import {
  curveExtent,
  curveKey,
  curvePath,
  curveStats,
  sparkPath,
  type ThrustCurve,
} from "./curves";

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

describe("sparkPath", () => {
  it("self-scales a curve into the box with a 1px inset", () => {
    // peak (t=1) → top inset (y=1); zero thrust → bottom inset (height-1=15).
    const d = sparkPath(
      [
        [0, 0],
        [1, 100],
        [2, 0],
      ],
      56,
      16,
    );
    expect(d).toBe("M0.0 15.0 L28.0 1.0 L56.0 15.0");
  });

  it("downsamples to at most 20 points, keeping first and last", () => {
    // Monotonic ramp: peak is the last point. First point (zero thrust) sits at
    // the bottom inset (y=15), the last (peak) at the top inset (y≈1).
    const many: ThrustCurve = Array.from({ length: 100 }, (_, i) => [i / 99, i]);
    const d = sparkPath(many);
    expect((d.match(/[ML]/g) ?? []).length).toBe(20); // capped to 20 points
    expect(d.startsWith("M0.0 15.0")).toBe(true); // first point kept (t=0, F=0)
    expect(d.endsWith(" 1.0")).toBe(true); // last point is the peak
  });

  it("returns '' for an unusable curve", () => {
    expect(sparkPath([[0, 0]])).toBe("");
    expect(sparkPath([])).toBe("");
  });
});

describe("curveStats", () => {
  it("computes peak, initial (first ½ s), and a neutral centroid for a flat burn", () => {
    // Constant 50 N for 2 s → centroid at the midpoint (0.5), initial = 50.
    expect(curveStats([[0, 50], [2, 50]])).toEqual({ peakN: 50, initialN: 50, centroid: 0.5 });
  });

  it("a front-loaded (regressive) burn has centroid < 0.5 and high initial thrust", () => {
    const s = curveStats([[0, 100], [1, 50], [2, 0]]);
    expect(s!.peakN).toBe(100);
    expect(s!.initialN).toBe(75); // strong early push
    expect(s!.centroid).toBeCloseTo(0.375, 3); // mass of impulse up front
  });

  it("a back-loaded (progressive) burn has centroid > 0.5 and low initial thrust", () => {
    const s = curveStats([[0, 0], [1, 50], [2, 100]]);
    expect(s!.peakN).toBe(100);
    expect(s!.initialN).toBe(25); // weak off the pad
    expect(s!.centroid).toBeCloseTo(0.625, 3);
  });

  it("returns null for an unusable curve", () => {
    expect(curveStats([[0, 0]])).toBeNull();
    expect(curveStats([])).toBeNull();
    expect(curveStats([[0, 0], [0, 50]])).toBeNull(); // zero burn time
  });
});
