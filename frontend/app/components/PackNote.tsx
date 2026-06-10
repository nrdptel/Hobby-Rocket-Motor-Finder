import { formatPrice } from "@/lib/derive";
import { packSize } from "@/lib/pack";

/** A small note under a multipack listing's price, e.g. "3-pack · $21.00 total".
 * The headline price is shown per-motor (pack-aware), so this makes clear the
 * vendor sells it in a pack and what the whole pack costs. Renders nothing for a
 * single, so normal listings are untouched. Shared by the table, card, and
 * detail page. */
export function PackNote({
  priceCents,
  currency,
  url,
}: {
  priceCents: number | null;
  currency: string;
  url: string;
}) {
  const pack = packSize(url);
  if (pack < 2 || priceCents == null) return null;
  return (
    <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
      {pack}-pack · {formatPrice(priceCents, currency)} total
    </span>
  );
}
