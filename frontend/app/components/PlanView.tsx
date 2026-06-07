"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { formatPrice, manufacturerLabel, motorPath, safeHref } from "@/lib/derive";
import {
  bestSingleVendor,
  buildOrderPlan,
  vendorOffers,
  type PlanItem,
} from "@/lib/plan";
import type { Motor } from "@/lib/snapshot";
import { useWatchlist } from "@/lib/watchlist";
import { SiteHeader } from "./SiteHeader";

const QTY_KEY = "hpr.orderQty.v1";
const SHIP_KEY = "hpr.orderShipping.v1";
const DEFAULT_SHIPPING_CENTS = 5000; // ~typical HPR HAZMAT fee per shipment

const usd = (cents: number) => formatPrice(cents, "USD");

/** "Plan your order": takes your starred motors + quantities and an estimated
 * shipping/HAZMAT cost per order, and works out the cheapest way to buy them all
 * across the tracked vendors — trading motor price against the number of separate
 * shipments. All client-side over the in-memory catalog. */
export function PlanView({ allMotors }: { allMotors: Motor[] }) {
  const { starred, hydrated, toggle } = useWatchlist();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [shippingCents, setShippingCents] = useState(DEFAULT_SHIPPING_CENTS);

  // Load persisted quantities + shipping estimate after mount (client only).
  useEffect(() => {
    try {
      const q = JSON.parse(localStorage.getItem(QTY_KEY) || "{}");
      if (q && typeof q === "object") setQty(q);
      const s = localStorage.getItem(SHIP_KEY);
      if (s != null && Number.isFinite(Number(s))) setShippingCents(Math.max(0, Math.round(Number(s))));
    } catch {
      /* ignore */
    }
  }, []);

  const qtyOf = (id: number) => qty[id] ?? 1;
  const setMotorQty = (id: number, n: number) => {
    const v = Math.max(1, Math.min(99, Math.round(n) || 1));
    setQty((prev) => {
      const next = { ...prev, [id]: v };
      try {
        localStorage.setItem(QTY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const setShipping = (cents: number) => {
    const v = Math.max(0, Math.round(cents) || 0);
    setShippingCents(v);
    try {
      localStorage.setItem(SHIP_KEY, String(v));
    } catch {
      /* ignore */
    }
  };

  const list = useMemo(
    () =>
      allMotors
        .filter((m) => starred.has(m.id))
        .sort((a, b) => a.designation.localeCompare(b.designation)),
    [allMotors, starred],
  );

  const items: PlanItem[] = useMemo(
    () => list.map((m) => ({ motor: m, qty: qtyOf(m.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, qty],
  );

  const plan = useMemo(() => buildOrderPlan(items, shippingCents), [items, shippingCents]);
  const single = useMemo(() => bestSingleVendor(items), [items]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <SiteHeader />
      <nav className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          ← All motors
        </Link>
      </nav>

      <header className="mt-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Plan your order
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          The cheapest way to buy your starred motors. HPR motors ship HAZMAT, so each separate
          order adds a fee — this trades motor price against the number of shipments.
        </p>
      </header>

      {!hydrated ? (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading your list…</p>
      ) : list.length === 0 ? (
        <div className="mt-8 rounded-md border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
          Your list is empty. Tap the <span className="font-medium">★</span> next to a motor in the{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
            catalog
          </Link>{" "}
          to add it here, then come back to plan the cheapest order.
        </div>
      ) : (
        <>
          {/* Shipping estimate */}
          <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <label htmlFor="ship" className="text-zinc-500 dark:text-zinc-400">
              Est. shipping / HAZMAT per order
            </label>
            <span className="text-zinc-400">$</span>
            <input
              id="ship"
              type="number"
              inputMode="numeric"
              min={0}
              value={Math.round(shippingCents / 100)}
              onChange={(e) => setShipping((Number(e.target.value) || 0) * 100)}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <span className="text-xs text-zinc-400">— set to 0 to ignore shipping</span>
          </div>

          {/* Recommendation cards */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {/* Cheapest total */}
            <section className="rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/40">
              <div className="text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Cheapest total
              </div>
              {plan.assignments.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  Nothing on your list is in stock right now.
                </p>
              ) : (
                <>
                  <div
                    data-testid="plan-total"
                    className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100"
                  >
                    {usd(plan.totalCents)}
                  </div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">
                    {usd(plan.motorCostCents)} motors + {usd(plan.shippingCents)} shipping ·{" "}
                    {plan.ordersCount} order{plan.ordersCount === 1 ? "" : "s"}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                    {plan.assignments.map((a) => (
                      <li key={a.vendorSlug}>
                        {a.vendorName} — {a.lines.length} motor{a.lines.length === 1 ? "" : "s"} (
                        {usd(a.subtotalCents)})
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* Fewest shipments / one order */}
            {single && (
              <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Fewest shipments
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {single.vendorName}
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  has {single.covers} of {single.coverable} · {usd(single.motorCostCents)} +{" "}
                  {usd(shippingCents)} shipping = {usd(single.motorCostCents + shippingCents)}
                </div>
                {single.missing.length > 0 ? (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Missing here: {single.missing.map((m) => m.designation).join(", ")}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                    Covers your whole list in one shipment.
                  </p>
                )}
              </section>
            )}
          </div>

          {/* The plan, by vendor */}
          {plan.assignments.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold tracking-tight">The plan</h2>
              <div className="mt-3 space-y-4">
                {plan.assignments.map((a) => (
                  <div
                    key={a.vendorSlug}
                    className="rounded-md border border-zinc-200 dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {a.vendorName}
                      </span>
                      <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
                        {usd(a.subtotalCents)}
                      </span>
                    </div>
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {a.lines.map((l) => (
                        <li key={l.motor.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="font-mono text-zinc-900 dark:text-zinc-100">
                              {l.qty}× {l.motor.designation}
                            </span>
                            <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                              {usd(l.unitPriceCents)} ea
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {usd(l.unitPriceCents * l.qty)}{" "}
                            <a
                              href={safeHref(l.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-300"
                            >
                              buy →
                            </a>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Out of stock everywhere */}
          {plan.unavailable.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold tracking-tight">Not in stock anywhere</h2>
              <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {plan.unavailable.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <Link href={motorPath(m)} className="font-mono text-zinc-900 hover:underline dark:text-zinc-100">
                      {m.designation}
                    </Link>
                    <Link
                      href={motorPath(m)}
                      className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      set a restock alert →
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Your list — quantities + remove */}
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">Your list ({list.length})</h2>
            <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {list.map((m) => {
                const offers = vendorOffers({ motor: m, qty: qtyOf(m.id) });
                const cheapest = offers.length
                  ? Math.min(...offers.map((o) => o.unitPriceCents))
                  : null;
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <Link
                        href={motorPath(m)}
                        className="font-mono text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {m.designation}
                      </Link>
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {manufacturerLabel(m.manufacturer)} ·{" "}
                        {cheapest != null
                          ? `${usd(cheapest)} · ${offers.length} vendor${offers.length === 1 ? "" : "s"}`
                          : "out of stock"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${m.designation}`}
                        onClick={() => setMotorQty(m.id, qtyOf(m.id) - 1)}
                        className="h-6 w-6 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        −
                      </button>
                      <span className="w-6 text-center tabular-nums">{qtyOf(m.id)}</span>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${m.designation}`}
                        onClick={() => setMotorQty(m.id, qtyOf(m.id) + 1)}
                        className="h-6 w-6 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${m.designation} from your list`}
                        onClick={() => toggle(m.id)}
                        className="ml-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
