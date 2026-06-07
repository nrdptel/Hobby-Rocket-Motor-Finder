import type { CatalogAvailability } from "@/lib/history";

// Below this fraction a motor that's in stock RIGHT NOW counts as a scarce
// grab-it-now find; below the upper one it's merely intermittent.
const RARE = 0.4;
const INTERMITTENT = 0.85;

/** A motor-level availability badge for the catalog, derived from history. It
 * only speaks up when it changes a buying decision:
 *  - amber "rarely in stock" — in stock now but usually NOT, so grab it;
 *  - zinc "often out of stock" — comes and goes.
 * Reliably-available motors (and out-of-stock ones, whose scarcity is already
 * told by their sold-out status + last-in-stock badge) get nothing, so the list
 * stays clean and the badge means something when it appears. */
export function MotorAvailabilityBadge({
  availability,
}: {
  availability: CatalogAvailability | undefined;
}) {
  if (!availability || !availability.meaningful || !availability.currentlyInStock) return null;
  const { fraction } = availability;
  if (fraction >= INTERMITTENT) return null;
  const pct = Math.round(fraction * 100);

  if (fraction < RARE) {
    return (
      <span
        className="rounded border border-amber-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-500/50 dark:text-amber-500"
        title={`In stock only ~${pct}% of the time since tracking began — grab it while it's here.`}
      >
        rarely in stock
      </span>
    );
  }
  return (
    <span
      className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
      title={`In stock ~${pct}% of the time since tracking began — it comes and goes.`}
    >
      often out
    </span>
  );
}
