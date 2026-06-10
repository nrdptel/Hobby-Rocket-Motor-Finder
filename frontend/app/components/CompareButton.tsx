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
      className={`-m-1.5 shrink-0 cursor-pointer p-1.5 leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? "text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      <CompareIcon className="h-[1.05rem] w-[1.05rem]" filled={selected} />
    </button>
  );
}
