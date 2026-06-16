"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  cheapestInStockCents,
  cheapestInStockListing,
  formatPrice,
  manufacturerLabel,
  manufacturerSlug,
  motorPath,
  safeHref,
  type SubstituteShape,
} from "@/lib/derive";
import {
  bestSingleVendor,
  buildOrderPlan,
  buildSwapSuggestions,
  vendorOffers,
  type PlanItem,
} from "@/lib/plan";
import { decodeSharedOrder, encodeSharedOrder, orderPlanToText } from "@/lib/planShare";
import type { Motor } from "@/lib/snapshot";
import { useWatchlist } from "@/lib/watchlist";
import { ClipboardIcon } from "./ClipboardIcon";
import { LinkIcon } from "./LinkIcon";
import { PackHint } from "./PackHint";
import { SiteHeader } from "./SiteHeader";

const QTY_KEY = "hpr.orderQty.v1";
const SHIP_KEY = "hpr.orderShipping.v1";
const DEFAULT_SHIPPING_CENTS = 5000; // ~typical HPR HAZMAT fee per shipment

const usd = (cents: number) => formatPrice(cents, "USD");
const byDesignation = (a: Motor, b: Motor) => a.designation.localeCompare(b.designation);

/** "Plan your order": takes a list of motors + quantities and an estimated
 * shipping/HAZMAT cost per order, and works out the cheapest way to buy them all
 * across the tracked vendors. The list is your ★ watchlist — OR a shared order
 * opened via a ?order= link (preview mode), which you can save to your own list.
 * Shareable (link) + exportable (plain text). All client-side. */
export function PlanView({
  allMotors,
  shapes = {},
}: {
  allMotors: Motor[];
  /** Thrust-curve shape stats for ranking swap suggestions, keyed by
   * "manufacturer|designation". */
  shapes?: Record<string, SubstituteShape>;
}) {
  const { starred, hydrated, toggle } = useWatchlist();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [shippingCents, setShippingCents] = useState(DEFAULT_SHIPPING_CENTS);
  const [copied, setCopied] = useState<"" | "link" | "text">("");

  // Shared-order preview: read ?order= on mount (client only, so the static page
  // doesn't need a Suspense boundary), resolve to motors, and preview it with its
  // own editable quantities/shipping until the viewer saves or dismisses it.
  const [orderParam, setOrderParam] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [previewQty, setPreviewQty] = useState<Record<number, number>>({});
  const [previewShipping, setPreviewShipping] = useState(DEFAULT_SHIPPING_CENTS);
  const [previewRemoved, setPreviewRemoved] = useState<Set<number>>(new Set());

  useEffect(() => {
    setOrderParam(new URLSearchParams(window.location.search).get("order"));
    try {
      const q = JSON.parse(localStorage.getItem(QTY_KEY) || "{}");
      if (q && typeof q === "object") setQty(q);
      const s = localStorage.getItem(SHIP_KEY);
      if (s != null && Number.isFinite(Number(s))) setShippingCents(Math.max(0, Math.round(Number(s))));
    } catch {
      /* ignore */
    }
  }, []);

  const sharedResolved = useMemo(() => {
    const order = orderParam ? decodeSharedOrder(orderParam) : null;
    if (!order) return null;
    const items: { motor: Motor; qty: number }[] = [];
    for (const e of order.items) {
      const m = allMotors.find(
        (x) => manufacturerSlug(x.manufacturer) === e.mfrSlug && x.designation === e.designation,
      );
      if (m) items.push({ motor: m, qty: e.qty });
    }
    return items.length > 0 ? { items, shippingCents: order.shippingCents } : null;
  }, [orderParam, allMotors]);

  // Seed the preview's editable state once the shared order resolves.
  useEffect(() => {
    if (!sharedResolved) return;
    const q: Record<number, number> = {};
    for (const it of sharedResolved.items) q[it.motor.id] = it.qty;
    setPreviewQty(q);
    setPreviewShipping(sharedResolved.shippingCents);
    setPreviewRemoved(new Set());
  }, [sharedResolved]);

  const previewing = !!sharedResolved && !dismissed;

  // Effective list / quantities / shipping, routed by mode.
  const list = useMemo(() => {
    if (previewing && sharedResolved) {
      return sharedResolved.items
        .map((s) => s.motor)
        .filter((m) => !previewRemoved.has(m.id))
        .sort(byDesignation);
    }
    return allMotors.filter((m) => starred.has(m.id)).sort(byDesignation);
  }, [previewing, sharedResolved, previewRemoved, allMotors, starred]);

  const qtyOf = (id: number) => (previewing ? previewQty[id] : qty[id]) ?? 1;
  const effShipping = previewing ? previewShipping : shippingCents;

  const setMotorQty = (id: number, n: number) => {
    const v = Math.max(1, Math.min(99, Math.round(n) || 1));
    if (previewing) {
      setPreviewQty((prev) => ({ ...prev, [id]: v }));
      return;
    }
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
    if (previewing) {
      setPreviewShipping(v);
      return;
    }
    setShippingCents(v);
    try {
      localStorage.setItem(SHIP_KEY, String(v));
    } catch {
      /* ignore */
    }
  };
  const removeFromList = (id: number) => {
    if (previewing) setPreviewRemoved((prev) => new Set(prev).add(id));
    else toggle(id);
  };

  const items: PlanItem[] = useMemo(
    () => list.map((m) => ({ motor: m, qty: qtyOf(m.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, qty, previewQty, previewing],
  );
  const plan = useMemo(() => buildOrderPlan(items, effShipping), [items, effShipping]);
  const single = useMemo(() => bestSingleVendor(items), [items]);

  // For each sold-out-everywhere motor, in-stock swaps to keep the order
  // buyable. Only on your own list (not a shared-order preview), and excluding
  // anything already starred so a swap you've added drops off the suggestions.
  const swapSuggestions = useMemo(
    () => (previewing ? [] : buildSwapSuggestions(plan.unavailable, allMotors, starred, 3, shapes)),
    [previewing, plan.unavailable, allMotors, starred, shapes],
  );

  const exitPreview = () => {
    setDismissed(true);
    setOrderParam(null);
    window.history.replaceState(window.history.state, "", "/plan");
  };
  const saveSharedToList = () => {
    for (const m of list) {
      if (!starred.has(m.id)) toggle(m.id);
      setQty((prev) => {
        const next = { ...prev, [m.id]: qtyOf(m.id) };
        try {
          localStorage.setItem(QTY_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
    setShippingCents(effShipping);
    try {
      localStorage.setItem(SHIP_KEY, String(effShipping));
    } catch {
      /* ignore */
    }
    exitPreview();
  };

  const copy = async (kind: "link" | "text") => {
    const text =
      kind === "link"
        ? `${window.location.origin}/plan?order=${encodeSharedOrder({
            shippingCents: effShipping,
            items: list.map((m) => ({
              mfrSlug: manufacturerSlug(m.manufacturer),
              designation: m.designation,
              qty: qtyOf(m.id),
            })),
          })}`
        : orderPlanToText(plan, effShipping);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

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
          {previewing && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/60 dark:bg-amber-950/40">
              <span className="text-amber-800 dark:text-amber-300">
                You&apos;re viewing a <strong>shared order</strong> ({list.length} motors), priced
                against current stock.
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={saveSharedToList}
                  className="rounded-full border border-amber-500 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-200"
                >
                  Save to my list
                </button>
                <button
                  type="button"
                  onClick={exitPreview}
                  className="text-xs text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-400"
                >
                  dismiss
                </button>
              </span>
            </div>
          )}

          {/* Share / export */}
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => copy("link")}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="A link that opens this order list (priced live) for whoever you send it to"
            >
              {copied === "link" ? (
                "Copied!"
              ) : (
                <>
                  <LinkIcon className="h-3.5 w-3.5" />
                  Copy share link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => copy("text")}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Copy a plain-text order summary to paste into an email"
            >
              {copied === "text" ? (
                "Copied!"
              ) : (
                <>
                  <ClipboardIcon className="h-3.5 w-3.5" />
                  Copy as text
                </>
              )}
            </button>
          </div>

          {/* Shipping estimate */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <label htmlFor="ship" className="text-zinc-500 dark:text-zinc-400">
              Est. shipping / HAZMAT per order
            </label>
            <span className="text-zinc-400">$</span>
            <input
              id="ship"
              type="number"
              inputMode="numeric"
              min={0}
              value={Math.round(effShipping / 100)}
              onChange={(e) => setShipping((Number(e.target.value) || 0) * 100)}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <span className="text-xs text-zinc-400">— set to 0 to ignore shipping</span>
          </div>

          {/* Recommendation cards */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
                  {usd(effShipping)} shipping = {usd(single.motorCostCents + effShipping)}
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
                  <div key={a.vendorSlug} className="rounded-md border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">{a.vendorName}</span>
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
                              {l.packSizeUnits > 1
                                ? `${usd(l.unitPriceCents)}/ea · ${l.packsToBuy}× ${l.packSizeUnits}-pack${
                                    l.packsToBuy * l.packSizeUnits > l.qty
                                      ? ` → ${l.packsToBuy * l.packSizeUnits} motors`
                                      : ""
                                  }`
                                : `${usd(l.unitPriceCents)} ea`}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {usd(l.lineCostCents)}{" "}
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

          {/* Out of stock everywhere — offer in-stock swaps to keep the order
              buyable, plus a restock-alert fallback. */}
          {plan.unavailable.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold tracking-tight">Not in stock anywhere</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {previewing
                  ? "Sold out everywhere right now."
                  : "Sold out everywhere — add an in-stock swap to keep your order buyable, or set a restock alert."}
              </p>
              <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {(previewing
                  ? plan.unavailable.map((m) => ({ soldOut: m, swaps: [] as Motor[] }))
                  : swapSuggestions
                ).map(({ soldOut: m, swaps }) => (
                  <li key={m.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={motorPath(m)}
                        className="font-mono text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {m.designation}
                      </Link>
                      <Link
                        href={motorPath(m)}
                        className="shrink-0 text-xs text-zinc-500 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      >
                        set a restock alert →
                      </Link>
                    </div>
                    {swaps.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">In stock instead:</span>
                        {swaps.map((s) => {
                          const price = cheapestInStockCents(s);
                          const cheapestL = cheapestInStockListing(s);
                          return (
                            <span
                              key={s.id}
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 py-0.5 pl-2 pr-1 text-xs dark:border-emerald-800/60 dark:bg-emerald-950/40"
                            >
                              <Link
                                href={motorPath(s)}
                                className="font-mono text-emerald-800 hover:underline dark:text-emerald-300"
                              >
                                {s.designation}
                              </Link>
                              {price != null && (
                                <span className="tabular-nums text-emerald-700/80 dark:text-emerald-400/80">
                                  {usd(price)}
                                  <PackHint url={cheapestL?.url} />
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggle(s.id)}
                                aria-label={`Add ${s.designation} to your order instead of ${m.designation}`}
                                title={`Add ${s.designation} to your order`}
                                className="ml-0.5 rounded-full bg-emerald-600 px-1.5 font-medium text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
                              >
                                + add
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The list — quantities + remove */}
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">
              {previewing ? "Shared list" : "Your list"} ({list.length})
            </h2>
            <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {list.map((m) => {
                const offers = vendorOffers({ motor: m, qty: qtyOf(m.id) });
                const cheapest = offers.length ? Math.min(...offers.map((o) => o.unitPriceCents)) : null;
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <Link href={motorPath(m)} className="font-mono text-zinc-900 hover:underline dark:text-zinc-100">
                        {m.designation}
                      </Link>
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {manufacturerLabel(m.manufacturer)} ·{" "}
                        {cheapest != null ? (
                          `${usd(cheapest)} · ${offers.length} vendor${offers.length === 1 ? "" : "s"}`
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-500">
                            out of stock
                          </span>
                        )}
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
                        aria-label={`Remove ${m.designation} from the list`}
                        onClick={() => removeFromList(m.id)}
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
