import type { CatalogAvailability } from "./history";

// Below this fraction a motor that's in stock RIGHT NOW counts as a scarce
// grab-it-now find; below the upper one it's merely intermittent.
export const RARE = 0.4;
export const INTERMITTENT = 0.85;

// A scarcity verdict is a claim about a long-run pattern, so it needs a longer
// tracked window than a neutral buyable-% does — don't brand a motor "rarely in
// stock" off a day or two of data, even though the math is valid for the window.
export const BADGE_MIN_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

export type AvailabilityBadge = { kind: "rare" | "intermittent"; pct: number };

/** Decide whether a motor earns a catalog availability badge, from its history.
 * Pure so the gating is unit-tested (the component just renders the result).
 * Returns null — i.e. NO badge — unless the motor is in stock now, has been
 * tracked long enough to make a scarcity claim, isn't reliably available, and
 * isn't discontinued (where "grab it" is the wrong nudge for remaindered stock). */
export function availabilityBadge(
  availability: CatalogAvailability | undefined,
  discontinued: boolean,
): AvailabilityBadge | null {
  if (discontinued) return null;
  if (!availability || availability.windowMs < BADGE_MIN_WINDOW_MS || !availability.currentlyInStock) {
    return null;
  }
  const { fraction } = availability;
  if (fraction >= INTERMITTENT) return null;
  return { kind: fraction < RARE ? "rare" : "intermittent", pct: Math.round(fraction * 100) };
}
