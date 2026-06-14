"use client";

import { useCompare } from "@/lib/compareSelection";
import { CompareIcon } from "./CompareIcon";

/** Toggle a motor in/out of the side-by-side comparison set. An icon-sized
 * control that matches the star + bell beside it (outline → filled when
 * selected), rather than a heavy text pill. Stays neutral until hydration so the
 * first client paint matches the server HTML. Disabled (with a hint) when the set
 * is full and this motor isn't already in it. */
export function CompareButton({
  motorId,
  designation,
}: {
  motorId: number;
  designation: string;
}) {
  const { isSelected, canAdd, toggle, hydrated } = useCompare();
  const selected = hydrated && isSelected(motorId);
  const blocked = hydrated && !canAdd(motorId);
  return (
    <button
      type="button"
      onClick={() => toggle(motorId)}
      disabled={blocked}
      aria-pressed={selected}
      aria-label={
        selected
          ? `Remove ${designation} from comparison`
          : `Add ${designation} to comparison`
      }
      title={
        blocked
          ? "You can compare up to 4 motors at once"
          : selected
            ? "Remove from comparison"
            : "Add to comparison"
      }
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md leading-none transition hover:bg-zinc-100 dark:hover:bg-zinc-800 md:h-7 md:w-7 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
        selected
          ? "text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      <CompareIcon className="h-5 w-5 md:h-[1.05rem] md:w-[1.05rem]" filled={selected} />
    </button>
  );
}
