import type { ListingHistory } from "./snapshot";

// A price marker for a single listing relative to its OWN tracked history — the
// "informed buying" signal. Unlike availability, price min/max is NOT
// cadence-sensitive (an observed price is a real price regardless of scrape
// gaps), so it's honest to use the full recorded history here.
export type PriceSignalKind = "lowest" | "drop" | "high";

export type PriceSignal = {
  kind: PriceSignalKind;
  label: string;
  title: string;
};

// How far above its own tracked low a price must sit before we call it out as
// "pricey" — keeps tiny wobbles from flagging every listing.
const ABOVE_LOW_MARGIN = 1.1;

// A single SKU's price doesn't realistically swing more than this; a bigger
// spread is almost always scraping noise (a misparsed multipack/HAZMAT price, or
// a glitchy early scrape), so we DON'T trust it for a signal. Without this guard
// one bad reading could make a listing read "lowest ever — was as high as $277".
const MAX_PLAUSIBLE_RATIO = 2.5;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Two prices are a trustworthy pair only if neither is wildly larger than the
 * other — otherwise one of them is noise and the comparison is meaningless.
 * Exported so the availability-history price range can apply the SAME guard. */
export function plausiblePair(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi <= lo * MAX_PLAUSIBLE_RATIO;
}

/** Price signal for a listing, or null when there's nothing worth saying (no
 * history, no current price, or the price has never moved). Priority: an at- or
 * below-low price ("lowest") outranks a recent dip ("drop"), which outranks a
 * price sitting above its own low ("high"). `currentCents` is the live listing
 * price; the low/high/prev come from the summary rollup. */
export function priceSignal(
  h: ListingHistory | undefined,
  currentCents: number | null,
  inStock = true,
): PriceSignal | null {
  // A price marker is a buy-cue — pointless (and misleading) on a listing you
  // can't actually buy, so suppress it when the listing is out of stock.
  if (!inStock || !h || currentCents == null) return null;
  const low = h.price_low_cents;
  const high = h.price_high_cents;
  const prev = h.price_prev_cents;
  // "moved" = we've seen more than one (trustworthy) price, so low/high mean
  // something. The plausibility guard rejects noisy spreads.
  const moved = low != null && high != null && high > low && plausiblePair(low, high);

  if (moved && currentCents <= low) {
    return {
      kind: "lowest",
      label: "lowest tracked",
      title: `The lowest price we've recorded since tracking began (was as high as ${dollars(high)}).`,
    };
  }
  if (prev != null && currentCents < prev && plausiblePair(currentCents, prev)) {
    return {
      kind: "drop",
      label: "price dropped",
      title: `Down from ${dollars(prev)} at the last price change.`,
    };
  }
  if (moved && currentCents >= low * ABOVE_LOW_MARGIN) {
    return {
      kind: "high",
      label: "above its low",
      title: `Above its tracked low of ${dollars(low)} — it's been cheaper before.`,
    };
  }
  return null;
}
