"use client";

import { useEffect, useState } from "react";

import { MAX_COMPARE } from "@/lib/compareSelection";
import type { Motor } from "@/lib/snapshotTypes";
import { ComparePageBody } from "../components/ComparePageBody";
import { type CurveSeries } from "../components/ThrustCurveChart";

// Client renderer for the compare view. Under static export the route can't read
// fs per-request, so the bare /compare page ships as one static shell and the
// browser resolves the requested motors from the build-time /compare-data.json.
//
// The shareable URL is the QUERY form `/compare?ids=1,2,3`: it serves the static
// /compare page directly (no redirect), so it's robust on Cloudflare Pages —
// unlike a /compare/<ids> path, which Pages' canonical-URL redirect turns into a
// loop. Legacy /compare/<ids> path links are 302'd to the query form by
// public/_redirects, so old shared links keep working. We still read the path as
// a fallback in case a path URL reaches the client without the redirect.

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
 * URL order (the column order). Tolerates an encoded comma and drops unparseable
 * ids — same logic the old server route used. */
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

/** The ids selection from the URL: the `?ids=` query (canonical), falling back to
 * a `/compare/<ids>` pathname. Empty string → render the pick-motors shell. */
function idsFromUrl(): string {
  const q = new URLSearchParams(window.location.search).get("ids");
  if (q) return q;
  const m = window.location.pathname.match(/^\/compare\/(.+?)\/?$/);
  return m ? m[1] : "";
}

export function CompareClient() {
  const [motors, setMotors] = useState<Motor[]>([]);
  const [curveSeries, setCurveSeries] = useState<CurveSeries[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = parseIds(idsFromUrl());
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
