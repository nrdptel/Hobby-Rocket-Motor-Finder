import type { Metadata } from "next";

import { CompareEmptyClient } from "./CompareEmptyClient";

export const metadata: Metadata = {
  title: "Compare motors — HPR Motor Finder",
  description:
    "Overlay the thrust curves and line up the specs of up to four high-power rocket motors side by side.",
  // A transient, selection-driven view — nothing universal to index.
  robots: { index: false, follow: false },
};

/** Bare /compare: a fully static empty-state shell. A real comparison lives at
 * /compare/<ids>, which a static shell renders client-side. Legacy /compare?ids=
 * links are redirected there client-side (see CompareEmptyClient). */
export default function ComparePage() {
  return <CompareEmptyClient />;
}
