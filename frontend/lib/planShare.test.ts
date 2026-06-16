import { describe, expect, it } from "vitest";

import type { OrderPlan } from "./plan";
import { decodeSharedOrder, encodeSharedOrder, orderPlanToText } from "./planShare";
import type { Motor } from "./snapshot";

describe("encode/decode shared order", () => {
  it("round-trips items + shipping through a URL-safe string", () => {
    const order = {
      shippingCents: 5000,
      items: [
        { mfrSlug: "aerotech", designation: "J90W", qty: 2 },
        { mfrSlug: "cesaroni", designation: "K530-IM", qty: 1 },
        { mfrSlug: "aerotech", designation: "F20W/L", qty: 3 }, // slash designation
      ],
    };
    const enc = encodeSharedOrder(order);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, no +/=
    expect(decodeSharedOrder(enc)).toEqual(order);
  });

  it("clamps quantities and drops malformed entries on decode", () => {
    const enc = encodeSharedOrder({
      shippingCents: 0,
      items: [{ mfrSlug: "aerotech", designation: "J90W", qty: 999 }],
    });
    const decoded = decodeSharedOrder(enc);
    expect(decoded?.items[0].qty).toBe(99); // clamped to max
    expect(decoded?.shippingCents).toBe(0);
  });

  it("returns null for garbage / empty", () => {
    expect(decodeSharedOrder("not-base64!!")).toBeNull();
    expect(decodeSharedOrder(btoa("[]"))).toBeNull();
    expect(decodeSharedOrder("")).toBeNull();
  });
});

describe("orderPlanToText", () => {
  it("formats a readable order summary", () => {
    const motor = (designation: string): Motor => ({
      id: 1,
      manufacturer: "AeroTech",
      designation,
      diameter_mm: 54,
      impulse_class: "J",
      total_impulse_ns: 2000,
      avg_thrust_n: 90,
      burn_time_s: 5,
      propellant: "X",
      delays: "6",
      delay_adjustable: true,
      listings: [],
    });
    const plan: OrderPlan = {
      assignments: [
        {
          vendorSlug: "wildman",
          vendorName: "Wildman Rocketry",
          lines: [
            { motor: motor("J90W"), qty: 2, unitPriceCents: 7500, packSizeUnits: 1, packsToBuy: 2, lineCostCents: 15000, url: "u" },
            { motor: motor("K530"), qty: 1, unitPriceCents: 6400, packSizeUnits: 1, packsToBuy: 1, lineCostCents: 6400, url: "u" },
          ],
          subtotalCents: 21400,
        },
      ],
      ordersCount: 1,
      motorCostCents: 21400,
      shippingCents: 5000,
      totalCents: 26400,
      unavailable: [motor("L1234")],
    };
    const text = orderPlanToText(plan, 5000);
    expect(text).toContain("Total: $264.00 — 1 order (est. $50.00 shipping/order)");
    expect(text).toContain("Wildman Rocketry — $214.00:");
    expect(text).toContain("  2× J90W — $75.00 ea");
    expect(text).toContain("Not in stock anywhere: L1234");
  });

  it("spells out a multipack line: per-unit, packs, the over-buy, and pack total", () => {
    const motor: Motor = {
      id: 2,
      manufacturer: "AeroTech",
      designation: "E26W",
      diameter_mm: 29,
      impulse_class: "E",
      total_impulse_ns: 40,
      avg_thrust_n: 26,
      burn_time_s: 1.5,
      propellant: "W",
      delays: "4",
      delay_adjustable: false,
      listings: [],
    };
    // Want 1; sold only as a 2-pack at $19.99 → buy 1 pack, get 2 motors.
    const plan: OrderPlan = {
      assignments: [
        {
          vendorSlug: "wildman",
          vendorName: "Wildman",
          lines: [
            { motor, qty: 1, unitPriceCents: 1000, packSizeUnits: 2, packsToBuy: 1, lineCostCents: 1999, url: "u" },
          ],
          subtotalCents: 1999,
        },
      ],
      ordersCount: 1,
      motorCostCents: 1999,
      shippingCents: 0,
      totalCents: 1999,
      unavailable: [],
    };
    const text = orderPlanToText(plan, 0);
    expect(text).toContain("1× E26W — $10.00/ea, 1× 2-pack (2 motors) = $19.99");
  });
});
