import { availabilityBadge } from "@/lib/availabilityBadge";
import { formatWindow, type CatalogAvailability } from "@/lib/history";

/** A motor-level availability badge for the catalog, derived from history. It
 * only speaks up when it changes a buying decision:
 *  - amber "rarely in stock" — in stock now but usually NOT, so grab it;
 *  - zinc "often out of stock" — comes and goes.
 * Reliably-available motors, out-of-stock ones (their scarcity is already told by
 * their sold-out status + last-in-stock badge), discontinued "old stock", and
 * anything tracked for too short a window get nothing — so the list stays clean
 * and the badge means something when it appears. All gating lives in the pure
 * `availabilityBadge()`; this just renders its verdict. */
export function MotorAvailabilityBadge({
  availability,
  discontinued = false,
}: {
  availability: CatalogAvailability | undefined;
  discontinued?: boolean;
}) {
  const badge = availabilityBadge(availability, discontinued);
  if (!badge) return null;
  // availability is non-null whenever badge is non-null.
  const windowLabel = formatWindow(availability!.windowMs);

  if (badge.kind === "rare") {
    return (
      <span
        className="rounded border border-amber-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-500/50 dark:text-amber-500"
        title={`In stock only ~${badge.pct}% of the time over the last ${windowLabel} — grab it while it's here.`}
      >
        rarely in stock
      </span>
    );
  }
  return (
    <span
      className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
      title={`In stock ~${badge.pct}% of the time over the last ${windowLabel} — it comes and goes.`}
    >
      often out
    </span>
  );
}
