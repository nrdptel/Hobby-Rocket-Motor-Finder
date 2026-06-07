import type { Metadata } from "next";

import { loadSnapshot } from "@/lib/snapshot";
import { MIN_CLASS } from "@/lib/derive";
import { PlanView } from "../components/PlanView";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Plan your order — HPR Motor Finder",
  description:
    "Find the cheapest way to buy your starred motors across vendors — the fewest HAZMAT shipments for the lowest total.",
  // The plan is built from your browser-local watchlist, so there's nothing
  // universal to index.
  robots: { index: false, follow: false },
};

export default async function PlanPage() {
  const snapshot = await loadSnapshot();
  // Same universe as the catalog: motors with a listing, mid-power and up.
  const allMotors = snapshot
    ? snapshot.motors.filter((m) => m.listings.length > 0 && m.impulse_class >= MIN_CLASS)
    : [];
  return <PlanView allMotors={allMotors} />;
}
