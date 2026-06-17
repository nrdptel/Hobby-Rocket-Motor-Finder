import { formatPrice } from "@/lib/derive";
import { packSize, type PackSource } from "@/lib/pack";

/** A small note under a multipack listing's price, e.g. "3-pack · $21.00 total".
 * The headline price is shown per-motor (pack-aware), so this makes clear the
 * vendor sells it in a pack and what the whole pack costs. Renders nothing for a
 * single, so normal listings are untouched. Shared by the table, card, and
 * detail page. ``listing`` carries the resolved pack size (with a URL fallback),
 * so the label always matches the per-unit price shown above it. */
export function PackNote({
  priceCents,
  currency,
  listing,
}: {
  priceCents: number | null;
  currency: string;
  listing: PackSource;
}) {
  const pack = packSize(listing);
  if (pack < 2 || priceCents == null) return null;
  return (
    <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
      {pack}-pack · {formatPrice(priceCents, currency)} total
    </span>
  );
}
