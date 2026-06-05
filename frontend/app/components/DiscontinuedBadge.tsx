/** A small "old stock" pill shown on a motor that's matched to a discontinued
 * (out-of-production) ThrustCurve motor. Signals scarcity: what's listed is the
 * last of it and won't be restocked once it sells. Renders nothing for current
 * motors, so only the rare discontinued one stands out. */
export function DiscontinuedBadge({ discontinued }: { discontinued?: boolean }) {
  if (!discontinued) return null;
  return (
    <span
      className="rounded border border-amber-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-500/50 dark:text-amber-500"
      title="Out of production — old stock that won't be restocked once it sells out."
    >
      old stock
    </span>
  );
}
