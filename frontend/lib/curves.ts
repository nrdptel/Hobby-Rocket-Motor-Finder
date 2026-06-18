// Thrust-curve sample data: one representative time/thrust series per motor,
// loaded from the `curves.json` sidecar (copied in by copy-snapshot.mjs) and
// joined to a snapshot motor by manufacturer|designation. The loader is
// server-only (node fs). The pure geometry/shape helpers live in
// ./curveGeometry (no fs) and are re-exported here so server callers keep their
// existing `@/lib/curves` imports; client components import them from
// ./curveGeometry directly to stay fs-free under static export.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { cache } from "react";

import type { CurveMap } from "./curveGeometry";

export type { ThrustPoint, ThrustCurve, CurveMap } from "./curveGeometry";
export {
  curveKey,
  curveExtent,
  curvePath,
  sparkPath,
  curveStats,
  buildShapeMap,
} from "./curveGeometry";

const CURVES_PATH = path.resolve(process.cwd(), "data", "curves.json");

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
