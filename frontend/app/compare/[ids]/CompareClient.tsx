"use client";

import { useEffect, useState } from "react";

import { MAX_COMPARE } from "@/lib/compareSelection";
import type { Motor } from "@/lib/snapshot";
import { ComparePageBody } from "../../components/ComparePageBody";
import { type CurveSeries } from "../../components/ThrustCurveChart";

// Client renderer for /compare/<ids>. Under static export the route can't read
// fs per-request, so a single static shell ships and the browser resolves the
// requested motors from the build-time `/compare-data.json` payload. The path
// form (/compare/1,2,3) is preserved — ids are read from the URL pathname, NOT a
// route param — so shared compare links keep working byte-for-byte.

/** Compact motor record as emitted by scripts/gen-compare-data.mjs — a subset of
 * Motor carrying exactly the fields CompareView/ComparePageBody read. */
type CompareData = {
  motors: Record<string, Motor>;
  curves: Record<string, [number, number][]>;
};

/** The sidecar key joining a curve to a motor — mirrors lib/curves curveKey. */
function curveKey(manufacturer: string, designation: string): string {
  return `${manufacturer}|${designation}`;
}

/** Parse the `1,2,3` segment into a de-duplicated, capped list of motor ids in
 * URL order (the column order). Same logic the old server route used: tolerates
 * an encoded comma and drops unparseable ids. */
function parseIds(raw: string): number[] {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw; unparseable ids drop out below */
  }
  const out: number[] = [];
  for (const part of decoded.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

/** Read the ids segment from the current pathname (`/compare/<ids>`). Returns ""
 * for the bare /compare/ shell so it renders the pick-motors empty state. */
function idsFromPath(pathname: string): string {
  const m = pathname.match(/^\/compare\/(.+?)\/?$/);
  return m ? m[1] : "";
}

export function CompareClient() {
  const [motors, setMotors] = useState<Motor[]>([]);
  const [curveSeries, setCurveSeries] = useState<CurveSeries[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = parseIds(idsFromPath(window.location.pathname));
    if (ids.length === 0) {
      setLoaded(true);
      return;
    }
    fetch("/compare-data.json")
      .then((r) => r.json() as Promise<CompareData>)
      .then((data) => {
        if (cancelled) return;
        // Resolve in URL order, skipping ids we don't recognize.
        const resolved = ids
          .map((id) => data.motors[String(id)])
          .filter((m): m is Motor => m != null);
        const series: CurveSeries[] = [];
        resolved.forEach((m, i) => {
          const pts = data.curves[curveKey(m.manufacturer, m.designation)];
          if (pts) series.push({ label: m.designation, points: pts, emphasis: i === 0 });
        });
        setMotors(resolved);
        setCurveSeries(series);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Until the payload resolves, render the same empty-state shell ComparePageBody
  // shows for <2 motors — so the page never flashes broken and SSR/hydration match.
  if (!loaded) return <ComparePageBody motors={[]} curveSeries={[]} />;
  return <ComparePageBody motors={motors} curveSeries={curveSeries} />;
}
