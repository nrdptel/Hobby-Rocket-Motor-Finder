"use client";

import { useWatchlist } from "@/lib/watchlist";

/** Toggle a motor in/out of the browser-persisted watchlist. Renders an
 * outline star until starred, a filled amber star once starred. Stays neutral
 * until hydration so the first client paint matches the server HTML. */
export function StarButton({
  motorId,
  designation,
}: {
  motorId: number;
  designation: string;
}) {
  const { isStarred, toggle, hydrated } = useWatchlist();
  const starred = hydrated && isStarred(motorId);
  return (
    <button
      type="button"
      onClick={() => toggle(motorId)}
      aria-pressed={starred}
      aria-label={
        starred
          ? `Remove ${designation} from watchlist`
          : `Add ${designation} to watchlist`
      }
      title={starred ? "Remove from watchlist" : "Add to watchlist"}
      className={`-m-1.5 shrink-0 cursor-pointer rounded p-1.5 text-base leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-900 ${
        starred
          ? "text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
          : "text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
