import { describe, expect, it } from "vitest";

import { availabilityBadge, BADGE_MIN_WINDOW_MS } from "./availabilityBadge";
import type { CatalogAvailability } from "./history";

const DAY = 24 * 60 * 60 * 1000;
const a = (over: Partial<CatalogAvailability> = {}): CatalogAvailability => ({
  fraction: 0.3,
  meaningful: true,
  windowMs: 6 * DAY, // past the 5-day gate by default
  currentlyInStock: true,
  ...over,
});

describe("availabilityBadge", () => {
  it("returns null when discontinued (wrong nudge for old stock)", () => {
    expect(availabilityBadge(a({ fraction: 0.1 }), true)).toBeNull();
  });

  it("returns null with no availability data", () => {
    expect(availabilityBadge(undefined, false)).toBeNull();
  });

  it("withholds the badge until the tracked window is long enough", () => {
    expect(availabilityBadge(a({ windowMs: BADGE_MIN_WINDOW_MS - 1 }), false)).toBeNull();
    expect(availabilityBadge(a({ windowMs: BADGE_MIN_WINDOW_MS }), false)).not.toBeNull();
  });

  it("returns null for a motor that isn't in stock now", () => {
    expect(availabilityBadge(a({ currentlyInStock: false }), false)).toBeNull();
  });

  it("returns null for a reliably-available motor", () => {
    expect(availabilityBadge(a({ fraction: 0.9 }), false)).toBeNull();
    expect(availabilityBadge(a({ fraction: 0.85 }), false)).toBeNull(); // boundary excluded
  });

  it("flags a scarce-but-in-stock motor as 'rare'", () => {
    expect(availabilityBadge(a({ fraction: 0.2 }), false)).toEqual({ kind: "rare", pct: 20 });
  });

  it("flags a middling motor as 'intermittent'", () => {
    expect(availabilityBadge(a({ fraction: 0.6 }), false)).toEqual({ kind: "intermittent", pct: 60 });
  });

  it("uses 0.4 as the rare/intermittent boundary (0.4 is intermittent)", () => {
    expect(availabilityBadge(a({ fraction: 0.39 }), false)?.kind).toBe("rare");
    expect(availabilityBadge(a({ fraction: 0.4 }), false)?.kind).toBe("intermittent");
  });
});
