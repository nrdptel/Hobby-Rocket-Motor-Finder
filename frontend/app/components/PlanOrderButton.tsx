"use client";

import Link from "next/link";

import { useWatchlist } from "@/lib/watchlist";
import { CartIcon } from "./CartIcon";

/** A cart-style entry to "Plan your order", in the top-right header. It's your
 * shopping cart — the motors you've starred — so it lives where carts live, and
 * shows the count. Always visible; with nothing starred it lands on the planner's
 * empty state, which explains the star-first flow. */
export function PlanOrderButton() {
  const { count, hydrated } = useWatchlist();
  return (
    <Link
      href="/plan"
      title="Plan the cheapest way to buy your starred motors across vendors"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
    >
      <CartIcon className="h-3.5 w-3.5" />
      Plan order{hydrated && count > 0 ? ` (${count})` : ""}
    </Link>
  );
}
