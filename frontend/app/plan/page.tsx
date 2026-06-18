import type { Metadata } from "next";

import { loadCatalogMotors, loadSnapshot } from "@/lib/snapshot";
import { mergedCatalog } from "@/lib/catalogMotors";
import { buildShapeMap, loadCurves } from "@/lib/curves";
import { MIN_CLASS } from "@/lib/derive";
import { PlanView } from "../components/PlanView";

// Hourly, matching the snapshot's scrape/redeploy cadence: the data is bundled at
// build time, so re-rendering more often only yields identical HTML and ISR writes.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Plan your order — HPR Motor Finder",
  description:
    "Find the cheapest way to buy your starred motors across vendors — the fewest HAZMAT shipments for the lowest total.",
  // The plan is built from your browser-local watchlist, so there's nothing
  // universal to index.
  robots: { index: false, follow: false },
};

export default async function PlanPage() {
  const [snapshot, catalog, curves] = await Promise.all([
    loadSnapshot(),
    loadCatalogMotors(),
    loadCurves(),
  ]);
  // The SAME universe as the catalog (incl. "phantom" motors no vendor stocks),
  // so a phantom you starred shows here as "not in stock anywhere" with a buyable
  // swap, instead of silently vanishing from your order.
  const allMotors = snapshot ? mergedCatalog(snapshot.motors, catalog, MIN_CLASS) : [];
  return <PlanView allMotors={allMotors} shapes={buildShapeMap(curves)} />;
}
