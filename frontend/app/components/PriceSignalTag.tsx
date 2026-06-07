import type { PriceSignal } from "@/lib/priceSignal";

/** A small marker next to a listing's price showing how it compares to its own
 * tracked history: emerald ``↓ lowest tracked`` / ``↓ price dropped`` for a good
 * time to buy, zinc ``↑ above its low`` as a heads-up that it's been cheaper.
 * Renders nothing when there's no signal, so stable-priced rows stay clean.
 * Shared by the desktop table, the mobile card, and the detail page. */
export function PriceSignalTag({ signal }: { signal: PriceSignal }) {
  const good = signal.kind === "lowest" || signal.kind === "drop";
  return (
    <span
      title={signal.title}
      className={
        "block text-[10px] font-medium tabular-nums " +
        (good
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-zinc-500 dark:text-zinc-400")
      }
    >
      {good ? "↓" : "↑"} {signal.label}
    </span>
  );
}
