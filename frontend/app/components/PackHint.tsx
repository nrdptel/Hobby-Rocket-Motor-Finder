import { packSize, type PackSource } from "@/lib/pack";

/** A compact "· N-pack" suffix shown after a per-unit price where a full
 * PackNote ("N-pack · $X total") doesn't fit — the loadout, swap chips, similar
 * motors. Renders nothing for a single, so non-pack rows are untouched. Keeps
 * every per-unit price across the site paired with its pack context, so a flyer
 * never reads "$7" without knowing the minimum buy is a 3-pack. ``listing``
 * carries the resolved pack size (URL fallback), matching the price beside it. */
export function PackHint({ listing }: { listing: PackSource | null | undefined }) {
  const n = listing ? packSize(listing) : 1;
  if (n < 2) return null;
  return <span className="text-zinc-500 dark:text-zinc-400"> · {n}-pack</span>;
}
