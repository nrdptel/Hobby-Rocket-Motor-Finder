// Pure thrust-curve geometry + shape stats (no fs / no react). Split out of
// lib/curves.ts so client components (ThrustCurveChart) can import these helpers
// without dragging the fs-backed `loadCurves` loader into a client/edge bundle.
// lib/curves.ts re-exports everything here, so server callers are unchanged.

import type { SubstituteShape } from "./derive";

/** One sample: [time_s, thrust_N]. */
export type ThrustPoint = [number, number];
export type ThrustCurve = ThrustPoint[];
export type CurveMap = Record<string, ThrustCurve>;

/** The sidecar key joining a curve to a motor — mirrors the backend's
 * `curve_key`. Neither field contains a "|", so the pair round-trips. */
export function curveKey(manufacturer: string, designation: string): string {
  return `${manufacturer}|${designation}`;
}

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

/** Evenly thin a point series to at most ``max`` points, always keeping the
 * first and last, so a catalog-row sparkline path stays short regardless of how
 * finely sampled the source curve is. */
function downsample(points: ThrustCurve, max: number): ThrustCurve {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: ThrustCurve = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** A compact SVG path for a row sparkline: the curve self-scaled to a small box
 * (each glyph normalized to its own peak/burn — it's a shape, not a comparison),
 * downsampled and rounded so the per-motor string shipped to the catalog client
 * stays tiny. A 1px inset keeps the stroke from clipping at the edges. Returns ""
 * for an unusable curve. */
export function sparkPath(points: ThrustCurve, width = 56, height = 16): string {
  const pts = downsample(points, 20);
  const { maxT, maxF } = curveExtent([pts]);
  if (pts.length < 2 || maxT <= 0 || maxF <= 0) return "";
  const inset = 1;
  const h = height - inset * 2;
  const x = (t: number) => (t / maxT) * width;
  const y = (f: number) => inset + (h - (f / maxF) * h);
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`)
    .join(" ");
}

// --- flight-shape stats (for substitute ranking) ---------------------------

/** Reduce a thrust curve to the few numbers that capture how a motor *flies*:
 * peak thrust (max-G), initial thrust (avg over the first ½ s → rail exit), and
 * the impulse centroid as a fraction of burn time (front-loaded/regressive ≈ 0,
 * back-loaded/progressive ≈ 1, neutral ≈ 0.5). Trapezoidal over the samples;
 * null for an unusable curve. */
export function curveStats(points: ThrustCurve): SubstituteShape | null {
  if (points.length < 2) return null;
  const burnS = points[points.length - 1][0];
  if (burnS <= 0) return null;
  const initWindow = Math.min(0.5, burnS);
  let peakN = 0;
  let impulse = 0;
  let moment = 0; // ∫ F·t dt — for the centroid
  let initImpulse = 0; // ∫ F dt over the first initWindow seconds
  for (let i = 1; i < points.length; i++) {
    const [t0, f0] = points[i - 1];
    const [t1, f1] = points[i];
    const dt = t1 - t0;
    if (dt <= 0) continue;
    if (f0 > peakN) peakN = f0;
    if (f1 > peakN) peakN = f1;
    const fAvg = (f0 + f1) / 2;
    const seg = fAvg * dt;
    impulse += seg;
    moment += fAvg * ((t0 + t1) / 2) * dt;
    if (t1 <= initWindow) initImpulse += seg;
    else if (t0 < initWindow) initImpulse += seg * ((initWindow - t0) / dt);
  }
  if (impulse <= 0) return null;
  const centroid = Math.max(0, Math.min(1, moment / impulse / burnS));
  return { peakN, initialN: initImpulse / initWindow, centroid };
}

/** A compact ``"<manufacturer>|<designation>" → shape`` map for every curve,
 * rounded to keep the payload small. Built server-side and shipped to the client
 * so the substitute ranker can judge flight similarity everywhere. */
export function buildShapeMap(curves: CurveMap): Record<string, SubstituteShape> {
  const out: Record<string, SubstituteShape> = {};
  for (const [key, pts] of Object.entries(curves)) {
    const s = curveStats(pts);
    if (s) {
      out[key] = {
        peakN: Math.round(s.peakN),
        initialN: Math.round(s.initialN),
        centroid: Math.round(s.centroid * 1000) / 1000,
      };
    }
  }
  return out;
}
