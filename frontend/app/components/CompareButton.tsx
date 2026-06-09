"use client";

import { useCompare } from "@/lib/compareSelection";

/** Toggle a motor in/out of the side-by-side comparison set. A compact pill that
 * fills in once selected. Stays neutral until hydration so the first client paint
 * matches the server HTML. Disabled (with a hint) when the set is full and this
 * motor isn't already in it. */
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
      className={`shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none transition disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? "border-indigo-500 bg-indigo-500 text-white dark:border-indigo-400 dark:bg-indigo-400 dark:text-zinc-900"
          : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
      }`}
    >
      Compare
    </button>
  );
}
