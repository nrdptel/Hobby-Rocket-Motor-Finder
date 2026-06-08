/** A small "sparky" pill for motors with metal-additive propellant (titanium
 * sponge etc.) that throw gold sparks — a crowd-pleaser at night, and often
 * restricted under fire bans. Renders nothing for normal motors, so only the
 * sparky ones stand out. */
export function SparkyBadge({ sparky }: { sparky?: boolean }) {
  if (!sparky) return null;
  return (
    <span
      className="rounded border border-amber-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-500/50 dark:text-amber-400"
      title="Sparky propellant — throws gold sparks (great at night; often restricted under fire bans)."
    >
      ✨ sparky
    </span>
  );
}
