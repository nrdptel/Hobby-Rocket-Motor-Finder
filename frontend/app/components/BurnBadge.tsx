import { burnCharacter } from "@/lib/derive";
import type { Motor } from "@/lib/snapshot";

/** A small pill flagging a motor's burn character — only the *notable* ends of
 * the range: a quick "punchy" burn or a sustained "long burn". The middle
 * ("standard") and unknown burns render nothing, so the table stays uncluttered
 * and only the distinctive motors are marked. */
export function BurnBadge({ motor }: { motor: Pick<Motor, "burn_time_s"> }) {
  const bc = burnCharacter(motor);
  if (bc === "long") {
    return (
      <span
        className="rounded border border-sky-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:border-sky-500/50 dark:text-sky-400"
        title="Long, sustained burn (3 s or more) — a slow, lofting push."
      >
        long burn
      </span>
    );
  }
  if (bc === "punchy") {
    return (
      <span
        className="rounded border border-orange-400/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-700 dark:border-orange-500/50 dark:text-orange-400"
        title="Short, snappy burn (under 1.5 s) — a hard, fast kick off the pad."
      >
        punchy
      </span>
    );
  }
  return null;
}
