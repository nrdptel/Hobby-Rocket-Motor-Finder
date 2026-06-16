import { packSize } from "@/lib/pack";

/** A compact "· N-pack" suffix shown after a per-unit price where a full
 * PackNote ("N-pack · $X total") doesn't fit — the loadout, swap chips, similar
 * motors. Renders nothing for a single, so non-pack rows are untouched. Keeps
 * every per-unit price across the site paired with its pack context, so a flyer
 * never reads "$7" without knowing the minimum buy is a 3-pack. */
export function PackHint({ url }: { url: string | null | undefined }) {
  const n = url ? packSize(url) : 1;
  if (n < 2) return null;
  return <span className="text-zinc-500 dark:text-zinc-400"> · {n}-pack</span>;
}
