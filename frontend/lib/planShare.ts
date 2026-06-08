// Share + export for "Plan your order". A shared link encodes the *inputs* — the
// motors (by stable manufacturer-slug + designation, not the volatile catalog id),
// their quantities, and the shipping estimate — so the recipient's page recomputes
// the cheapest plan against the CURRENT stock/prices. Export produces a plain-text
// order summary to paste into an email (e.g. to a club treasurer or a vendor).

import type { OrderPlan } from "./plan";

export type SharedOrderEntry = { mfrSlug: string; designation: string; qty: number };
export type SharedOrder = { shippingCents: number; items: SharedOrderEntry[] };

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode an order into a compact, URL-safe `?order=` value. */
export function encodeSharedOrder(order: SharedOrder): string {
  const payload = {
    s: Math.round(order.shippingCents / 100), // dollars, to keep it short
    m: order.items.map((i) => [i.mfrSlug, i.designation, i.qty] as const),
  };
  return b64urlEncode(JSON.stringify(payload));
}

/** Decode a `?order=` value, tolerating anything malformed by returning null. */
export function decodeSharedOrder(encoded: string): SharedOrder | null {
  try {
    const p = JSON.parse(b64urlDecode(encoded)) as { s?: unknown; m?: unknown };
    if (!Array.isArray(p.m)) return null;
    const items: SharedOrderEntry[] = [];
    for (const e of p.m) {
      if (!Array.isArray(e) || e.length < 3) continue;
      const [slug, designation, qty] = e;
      if (typeof slug !== "string" || typeof designation !== "string") continue;
      const q = Math.max(1, Math.min(99, Math.round(Number(qty)) || 1));
      items.push({ mfrSlug: slug, designation, qty: q });
    }
    if (items.length === 0) return null;
    const shippingCents = Math.max(0, (Number(p.s) || 0) * 100);
    return { shippingCents, items };
  } catch {
    return null;
  }
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Plain-text order summary for pasting into an email. */
export function orderPlanToText(plan: OrderPlan, shippingCents: number): string {
  const lines: string[] = [];
  lines.push("HPR motor order");
  const shipNote = shippingCents > 0 ? ` (est. ${dollars(shippingCents)} shipping/order)` : "";
  lines.push(`Total: ${dollars(plan.totalCents)} — ${plan.ordersCount} order${plan.ordersCount === 1 ? "" : "s"}${shipNote}`);
  lines.push("");
  for (const a of plan.assignments) {
    lines.push(`${a.vendorName} — ${dollars(a.subtotalCents)}:`);
    for (const l of a.lines) {
      const received = l.packsToBuy * l.packSizeUnits;
      const detail =
        l.packSizeUnits > 1
          ? `${dollars(l.unitPriceCents)}/ea, ${l.packsToBuy}× ${l.packSizeUnits}-pack${
              received > l.qty ? ` (${received} motors)` : ""
            } = ${dollars(l.lineCostCents)}`
          : `${dollars(l.unitPriceCents)} ea`;
      lines.push(`  ${l.qty}× ${l.motor.designation} — ${detail}`);
    }
    lines.push("");
  }
  if (plan.unavailable.length > 0) {
    lines.push(`Not in stock anywhere: ${plan.unavailable.map((m) => m.designation).join(", ")}`);
  }
  return lines.join("\n").trim() + "\n";
}
