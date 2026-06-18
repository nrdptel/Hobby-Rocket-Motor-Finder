import type { Metadata } from "next";

import { CompareClient } from "./CompareClient";

// Static-export shell for /compare/<ids>. The page itself reads NO fs and renders
// a single client component that resolves the requested motors from the
// build-time /compare-data.json payload in the browser (see CompareClient).
//
// generateStaticParams returns one placeholder param so exactly ONE shell HTML
// is emitted (out/compare/_/index.html). public/_redirects then rewrites any
// /compare/<ids> URL to that shell with a 200 (a rewrite, not a redirect), so the
// shareable path form /compare/1,2,3 is preserved while only one file ships.
export const metadata: Metadata = {
  title: "Compare motors — HPR Motor Finder",
  description:
    "Overlay the thrust curves and line up the specs of up to four high-power rocket motors side by side.",
  // A transient, selection-driven view — nothing universal to index.
  robots: { index: false, follow: false },
};

export function generateStaticParams(): { ids: string }[] {
  // One placeholder shell; the _redirects rewrite serves it for every /compare/*.
  return [{ ids: "_" }];
}

export default function ComparePage() {
  return <CompareClient />;
}
