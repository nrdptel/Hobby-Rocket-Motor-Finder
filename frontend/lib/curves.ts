// Thrust-curve sample data: one representative time/thrust series per motor,
// loaded from the `curves.json` sidecar (copied in by copy-snapshot.mjs) and
// joined to a snapshot motor by manufacturer|designation. The loader is
// server-only (node fs); the geometry helpers are pure and unit-tested.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { cache } from "react";

/** One sample: [time_s, thrust_N]. */
export type ThrustPoint = [number, number];
export type ThrustCurve = ThrustPoint[];
export type CurveMap = Record<string, ThrustCurve>;

const CURVES_PATH = path.resolve(process.cwd(), "data", "curves.json");

/** The sidecar key joining a curve to a motor — mirrors the backend's
 * `curve_key`. Neither field contains a "|", so the pair round-trips. */
export function curveKey(manufacturer: string, designation: string): string {
  return `${manufacturer}|${designation}`;
}

async function loadCurvesImpl(): Promise<CurveMap> {
  try {
    const raw = await readFile(CURVES_PATH, "utf-8");
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as CurveMap) : {};
  } catch {
    // Sidecar absent (fresh clone before `hpr catalog curves`) → no curves.
    return {};
  }
}

/** Load the full curve map once per request (React-cached). */
export const loadCurves = cache(loadCurvesImpl);

// --- pure geometry (no fs/react; unit-tested) ------------------------------

/** Largest time and thrust across a set of series — the shared axes for an
 * overlay so every curve is drawn to the same scale. */
export function curveExtent(series: readonly ThrustCurve[]): { maxT: number; maxF: number } {
  let maxT = 0;
  let maxF = 0;
  for (const s of series) {
    for (const [t, f] of s) {
      if (t > maxT) maxT = t;
      if (f > maxF) maxF = f;
    }
  }
  return { maxT, maxF };
}

/** SVG polyline path for a curve mapped into a ``width`` × ``height`` box, with
 * the origin at top-left and the y-axis inverted (thrust grows upward). Returns
 * "" for fewer than two points or a degenerate extent. */
export function curvePath(
  points: ThrustCurve,
  opts: { width: number; height: number; maxT: number; maxF: number },
): string {
  const { width, height, maxT, maxF } = opts;
  if (points.length < 2 || maxT <= 0 || maxF <= 0) return "";
  const x = (t: number) => (t / maxT) * width;
  const y = (f: number) => height - (f / maxF) * height;
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)}`)
    .join(" ");
}
