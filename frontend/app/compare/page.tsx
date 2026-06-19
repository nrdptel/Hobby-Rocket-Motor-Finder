import type { Metadata } from "next";

import { CompareClient } from "./CompareClient";

export const metadata: Metadata = {
  title: "Compare motors — HPR Motor Finder",
  description:
    "Overlay the thrust curves and line up the specs of up to four high-power rocket motors side by side.",
  // A transient, selection-driven view — nothing universal to index.
  robots: { index: false, follow: false },
};

/** /compare is one fully static shell. With no `?ids=` it shows the pick-motors
 * empty state; with `?ids=1,2,3` the client resolves those motors from the
 * build-time /compare-data.json and renders the side-by-side view. The query
 * form serves this page directly on Cloudflare Pages (no redirect loop); legacy
 * /compare/<ids> path links are 302'd here by public/_redirects. */
export default function ComparePage() {
  return <CompareClient />;
}
