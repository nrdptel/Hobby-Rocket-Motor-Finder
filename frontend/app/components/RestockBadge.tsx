import type { ListingHistory } from "@/lib/snapshot";
import { restockLabel } from "@/lib/derive";

/** A small history marker shown next to a listing's status:
 *  - emerald "restocked 3h ago" when an in-stock listing genuinely came back
 *    in the last ~14 days;
 *  - zinc "last in stock 2d ago" when a now-out-of-stock listing had stock
 *    within ~30 days.
 * Renders nothing otherwise, so the vast majority of rows stay clean. Shared by
 * the desktop table and the mobile card so the wording stays in one place. */
export function RestockBadge({
  history,
  now,
}: {
  history: ListingHistory | undefined;
  now: Date;
}) {
  const label = restockLabel(history, now);
  if (!label) return null;
  const restocked = label.startsWith("restocked");
  return (
    <span
      className={
        "ml-1.5 text-xs " +
        (restocked
          ? "text-emerald-600 dark:text-emerald-500/90"
          : "text-zinc-500 dark:text-zinc-400")
      }
      title={
        restocked
          ? "This listing went out of stock and came back — time since it returned."
          : "How long ago this listing was last seen in stock."
      }
    >
      {label}
    </span>
  );
}
