// Monthly observances — small, tasteful flourishes the site shows during the
// months they fall in (a thin accent rule at the top of the page and a warm
// line in the footer), in the spirit of a Google Doodle. Multiple observances
// can share a month (June is both Pride and Men's Mental Health Month), so each
// month maps to a list and every active one renders.
//
// Evaluated from `new Date()` at render time. The pages that use this are static
// / ISR (revalidate 60s), so an observance appears and disappears within a
// revalidation window of the month rolling over — no per-request work.

export type Observance = {
  /** Stable key (for React lists). */
  id: string;
  /** Leading emoji for the footer line. */
  emoji: string;
  /** Warm one-line footer message. */
  message: string;
  /** Optional supportive/resource link shown after the message. */
  href?: string;
  /** Visible label for the link (an arrow is appended in the UI). */
  hrefLabel?: string;
  /** Optional thin accent rule at the top of the page. `background` is any CSS
   *  background value; `title` is the hover/AT tooltip (the bar is aria-hidden). */
  bar?: { background: string; title: string };
};

// Classic six-stripe Pride flag, left to right.
const PRIDE_GRADIENT =
  "linear-gradient(to right, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787)";
// Emerald — the site's own accent colour, and a fit for the mental-health green ribbon.
const MENTAL_HEALTH_GREEN = "linear-gradient(to right, #34d399, #059669)";

// Keyed by month index (0 = January … 11 = December).
const OBSERVANCES: Record<number, Observance[]> = {
  5: [
    {
      id: "pride",
      emoji: "🏳️‍🌈",
      message: "Happy Pride Month — fly high.",
      href: "https://www.thetrevorproject.org",
      hrefLabel: "The Trevor Project",
      bar: { background: PRIDE_GRADIENT, title: "Happy Pride Month 🏳️‍🌈" },
    },
    {
      id: "mens-mental-health",
      emoji: "💚",
      message: "June is Men's Mental Health Month — you're not flying solo.",
      href: "https://988lifeline.org",
      hrefLabel: "988 Lifeline",
      bar: { background: MENTAL_HEALTH_GREEN, title: "Men's Mental Health Month 💚" },
    },
  ],
};

/** Observances active for the given date (defaults to now), in display order. */
export function observancesForDate(date: Date = new Date()): Observance[] {
  return OBSERVANCES[date.getMonth()] ?? [];
}
