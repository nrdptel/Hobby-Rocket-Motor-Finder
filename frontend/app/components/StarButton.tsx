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
      className={`shrink-0 cursor-pointer text-base leading-none transition ${
        starred
          ? "text-amber-400 hover:text-amber-300"
          : "text-zinc-600 hover:text-zinc-300"
      }`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
