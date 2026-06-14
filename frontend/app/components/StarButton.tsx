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
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg leading-none transition hover:bg-zinc-100 dark:hover:bg-zinc-800 md:h-7 md:w-7 md:text-base ${
        starred
          ? "text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
          : "text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
