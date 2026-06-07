import { describe, expect, it } from "vitest";

import { priceSignal } from "./priceSignal";
import type { ListingHistory } from "./snapshot";

// Minimal history fixture — only the price fields matter to priceSignal.
function h(over: Partial<ListingHistory>): ListingHistory {
  return {
    currently_in_stock: true,
    status_current: "in_stock",
    first_seen_at: "2026-06-05T18:00:00Z",
    last_change_at: "2026-06-06T18:00:00Z",
    last_in_stock_at: "2026-06-06T18:00:00Z",
    last_restock_at: null,
    restock_count: 0,
    price_current_cents: null,
    price_prev_cents: null,
    price_low_cents: null,
    price_high_cents: null,
    ...over,
  };
}

describe("priceSignal", () => {
  it("returns null with no history or no current price", () => {
    expect(priceSignal(undefined, 1000)).toBeNull();
    expect(priceSignal(h({ price_low_cents: 1000, price_high_cents: 2000 }), null)).toBeNull();
  });

  it("returns null when the price has never moved (low == high)", () => {
    expect(priceSignal(h({ price_low_cents: 1500, price_high_cents: 1500 }), 1500)).toBeNull();
  });

  it("flags the lowest tracked price when at/below the low and it has been higher", () => {
    const s = priceSignal(h({ price_low_cents: 1500, price_high_cents: 2000 }), 1500);
    expect(s?.kind).toBe("lowest");
  });

  it("flags a recent drop from the previous price", () => {
    // Current is between low and high but below the previous change → "drop".
    const s = priceSignal(
      h({ price_low_cents: 1500, price_high_cents: 2200, price_prev_cents: 2000 }),
      1800,
    );
    expect(s?.kind).toBe("drop");
  });

  it("prefers 'lowest' over 'drop' when both apply", () => {
    // Dropped from 2000 to 1500, which is also the all-time low.
    const s = priceSignal(
      h({ price_low_cents: 1500, price_high_cents: 2000, price_prev_cents: 2000 }),
      1500,
    );
    expect(s?.kind).toBe("lowest");
  });

  it("flags a price sitting above its own tracked low", () => {
    // 2000 is well above the 1500 low (>10%) and there's no recent drop.
    const s = priceSignal(h({ price_low_cents: 1500, price_high_cents: 2000 }), 2000);
    expect(s?.kind).toBe("high");
  });

  it("does not flag 'high' for a price within the margin of its low", () => {
    // 1600 is only ~6.7% above the 1500 low → not pricey enough to call out.
    expect(priceSignal(h({ price_low_cents: 1500, price_high_cents: 2000 }), 1600)).toBeNull();
  });

  it("ignores an implausible low/high spread (scraping noise)", () => {
    // The exact garbage range seen in real data: $29.74 -> $277.19 (9x).
    expect(priceSignal(h({ price_low_cents: 2974, price_high_cents: 27719 }), 2974)).toBeNull();
  });

  it("ignores an implausible drop from a noisy previous price", () => {
    // "Dropped" from $277 to $30 is noise, not a real sale.
    expect(
      priceSignal(h({ price_low_cents: 2974, price_high_cents: 27719, price_prev_cents: 27719 }), 2974),
    ).toBeNull();
  });

  it("still flags a plausible drop (within the ratio guard)", () => {
    // $25 -> $20: a believable 20% dip.
    const s = priceSignal(
      h({ price_low_cents: 2000, price_high_cents: 2500, price_prev_cents: 2500 }),
      2000,
    );
    expect(s?.kind).toBe("lowest"); // also the low → strongest signal
  });

  it("includes the comparison price in the tooltip", () => {
    const s = priceSignal(
      h({ price_low_cents: 1500, price_high_cents: 2200, price_prev_cents: 2000 }),
      1800,
    );
    expect(s?.title).toContain("$20.00");
  });
});
