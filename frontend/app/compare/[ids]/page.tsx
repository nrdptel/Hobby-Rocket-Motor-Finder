import type { Metadata } from "next";

import { loadCatalogMotors, loadSnapshot } from "@/lib/snapshot";
import { mergedCatalog } from "@/lib/catalogMotors";
import { curveKey, loadCurves } from "@/lib/curves";
import { MIN_CLASS } from "@/lib/derive";
import { MAX_COMPARE } from "@/lib/compareSelection";
import { type CurveSeries } from "../../components/ThrustCurveChart";
import { ComparePageBody } from "../../components/ComparePageBody";

export const revalidate = 60;

// Prerender no specific comparison; each unique id-combination renders on its
// first request and is then ISR-cached (s-maxage), so shared compare links serve
// from the edge instead of forcing a per-request dynamic render. The server
// still resolves only the 2–4 selected motors, so the payload stays tiny.
export function generateStaticParams() {
  return [];
}

export const metadata: Metadata = {
  title: "Compare motors — HPR Motor Finder",
  description:
    "Overlay the thrust curves and line up the specs of up to four high-power rocket motors side by side.",
  // A transient, selection-driven view — nothing universal to index.
  robots: { index: false, follow: false },
};

/** Parse the ``1,2,3`` path segment into a de-duplicated, capped list of motor
 * ids in the order given (URL order is the column order). Tolerates an encoded
 * comma (``1%2C2``) so legacy redirects resolve identically. */
function parseIds(raw: string): number[] {
  // Next already URL-decodes the segment; the extra decode only matters if a
  // comma arrived encoded (%2C). Guard it — a malformed percent-sequence
  // (e.g. /compare/%ZZ) would otherwise throw and 500 instead of falling through
  // to the pick-motors prompt.
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

export default async function ComparePage({ params }: { params: Promise<{ ids: string }> }) {
  const ids = parseIds((await params).ids);
  const [snapshot, catalog, curves] = await Promise.all([
    loadSnapshot(),
    loadCatalogMotors(),
    loadCurves(),
  ]);

  const allMotors = snapshot ? mergedCatalog(snapshot.motors, catalog, MIN_CLASS) : [];
  const byId = new Map(allMotors.map((m) => [m.id, m]));
  // Resolve in URL order, skipping ids we don't recognize.
  const motors = ids.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => m != null);

  // Overlay only the motors that actually have a curve; the spec table still
  // covers every motor.
  const curveSeries: CurveSeries[] = [];
  motors.forEach((m, i) => {
    const pts = curves[curveKey(m.manufacturer, m.designation)];
    if (pts) curveSeries.push({ label: m.designation, points: pts, emphasis: i === 0 });
  });

  return <ComparePageBody motors={motors} curveSeries={curveSeries} />;
}
