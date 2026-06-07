"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  bestInStockPriceCents,
  formatBurn,
  formatImpulse,
  formatPrice,
  formatThrust,
  isBestInStockPrice,
  listingInStock,
  manufacturerLabel,
  motorPath,
  safeHref,
} from "@/lib/derive";
import type { GroupedMotor, Substitute } from "@/lib/derive";
import type { CatalogAvailability } from "@/lib/history";
import type { HistorySummary } from "@/lib/snapshot";
import { useWatchlist } from "@/lib/watchlist";
import { priceSignal } from "@/lib/priceSignal";
import { BestPriceTag } from "./BestPriceTag";
import { CertBadge } from "./CertBadge";
import { PriceSignalTag } from "./PriceSignalTag";
import { DiscontinuedBadge } from "./DiscontinuedBadge";
import { MotorAvailabilityBadge } from "./MotorAvailabilityBadge";
import { MotorCard } from "./MotorCard";
import { RestockBadge } from "./RestockBadge";
import { StaleBadge } from "./StaleBadge";
import { NotifyButton } from "./NotifyButton";
import { StarButton } from "./StarButton";
import { StatusBadge } from "./StatusBadge";
import { Substitutes } from "./Substitutes";

/** The interactive results area: a grouped desktop table and the mobile card
 * list, plus the watchlist overlay. It's a client component so the "starred
 * only" view is a plain array filter over the server-prepared, already-grouped
 * motors — no DOM hacks, no second source of truth. The server still does all
 * the heavy lifting (snapshot load, URL filtering, grouping) and passes plain
 * serializable data down.
 *
 * Desktop layout: rather than rowSpan a motor's seven spec columns down all of
 * its listing rows (which leaves tall empty cells for popular motors), each
 * motor is a full-width header row — designation + specs + performance inline —
 * followed by a tight set of listing rows (variety / delay / vendor / status /
 * price). Six columns instead of thirteen, and no dead whitespace. */
export function MotorResults({
  motors,
  showManufacturer,
  generatedAt,
  starredOnly,
  history,
  availability,
  substitutes,
}: {
  motors: GroupedMotor[];
  showManufacturer: boolean;
  generatedAt: string;
  starredOnly: boolean;
  history: HistorySummary;
  availability: Record<number, CatalogAvailability>;
  substitutes: Record<number, Substitute[]>;
}) {
  const { starred, hydrated, count } = useWatchlist();
  const now = new Date(generatedAt);

  // Apply the watchlist overlay only after hydration, so SSR (which can't read
  // localStorage) and the first client paint render the same list.
  const applyStarred = starredOnly && hydrated;
  const visible = applyStarred ? motors.filter((m) => starred.has(m.id)) : motors;

  const inStockCount = visible.filter((m) =>
    m.listings.some((l) => listingInStock(l.status)),
  ).length;

  // Render the (up to ~600-motor) list without making the initial paint + hydrate
  // it all in one heavy task. SSR and the first client paint emit only the first
  // BATCH, so the page is fast and interactive instantly; then we auto-grow the
  // window — a chunk PER ANIMATION FRAME — until the whole list is rendered. The
  // viewer never has to scroll or click to load the rest, and the fill never
  // blocks the main thread (and adds no download — the full set is already in
  // memory). Reset to the first batch whenever the filtered/starred set changes.
  const BATCH = 50;
  const [shown, setShown] = useState(BATCH);
  useEffect(() => {
    setShown(BATCH);
  }, [motors, applyStarred]);
  useEffect(() => {
    if (shown >= visible.length) return;
    const id = requestAnimationFrame(() => setShown((s) => Math.min(s + BATCH, visible.length)));
    return () => cancelAnimationFrame(id);
  }, [shown, visible.length]);
  const windowed = visible.slice(0, shown);

  // Empty-state copy depends on *why* it's empty.
  let emptyMessage = "No motors match the current filters.";
  if (applyStarred && count === 0) {
    emptyMessage = "You haven't starred any motors yet — tap the ☆ next to a motor to add it.";
  } else if (applyStarred && visible.length === 0) {
    emptyMessage = "None of your starred motors match the current filters.";
  }

  return (
    <>
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        {visible.length} {applyStarred ? "starred " : ""}
        {visible.length === 1 ? "motor" : "motors"} · {inStockCount} with stock somewhere
      </p>

      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th
                scope="col"
                className="px-3 py-2"
                title="The full vendor designation, e.g. D13-10W or H242T-14A — what the vendor actually lists the SKU as."
              >
                Variety
              </th>
              <th
                scope="col"
                className="px-3 py-2"
                title="Ejection-charge delay time. For HPR motors, 'adj' means the delay is drilled to length at the field."
              >
                Delay
              </th>
              <th scope="col" className="px-3 py-2">Vendor</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2 text-right">Price</th>
              <th scope="col" className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              windowed.flatMap((m) => {
                const rows: ReactNode[] = [];
                // Motor header row — full width, the section divider that holds
                // the spec + performance data instead of per-column rowSpans.
                rows.push(
                  <tr
                    key={`${m.id}-head`}
                    className="border-t-2 border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/50"
                  >
                    <td colSpan={6} className="px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5">
                          <StarButton motorId={m.id} designation={m.designation} />
                          <NotifyButton manufacturer={m.manufacturer} designation={m.designation} />
                          <Link
                            href={motorPath(m)}
                            className="font-mono text-base text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:decoration-zinc-300"
                            title={`${m.designation} details, specs & all vendors`}
                          >
                            {m.designation}
                          </Link>
                          <CertBadge impulseClass={m.impulse_class} />
                          <DiscontinuedBadge discontinued={m.discontinued} />
                          {!m.discontinued && (
                            <MotorAvailabilityBadge availability={availability[m.id]} />
                          )}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {showManufacturer ? `${manufacturerLabel(m.manufacturer)} · ` : ""}
                          {m.impulse_class} · {m.diameter_mm}mm
                          {m.propellant ? ` · ${m.propellant}` : ""}
                          {m.case_info
                            ? ` · ${m.case_info}`
                            : m.motor_type === "SU"
                              ? " · single use"
                              : ""}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-500">
                          {formatImpulse(m.total_impulse_ns)} · {formatThrust(m.avg_thrust_n)} ·{" "}
                          {formatBurn(m.burn_time_s)}
                        </span>
                      </div>
                    </td>
                  </tr>,
                );
                for (const g of m.delayGroups) {
                  const bestCents = bestInStockPriceCents(g.listings);
                  g.listings.forEach((l, i) => {
                    const isBestPrice = isBestInStockPrice(l, bestCents);
                    const isDelayFirst = i === 0;
                    // Only a buy-cue for listings you can actually buy.
                    const sig = listingInStock(l.status)
                      ? priceSignal(history[l.url], l.price_cents)
                      : null;
                    rows.push(
                      <tr
                        key={`${m.id}-${g.delay}-${l.vendor_slug}-${i}`}
                        className={
                          "hover:bg-zinc-100 dark:hover:bg-zinc-900/40 " +
                          (isDelayFirst ? "border-t border-zinc-200 dark:border-zinc-800/60" : "")
                        }
                      >
                        {isDelayFirst && (
                          <>
                            <td
                              rowSpan={g.listings.length}
                              className="px-3 py-2 font-mono text-zinc-600 align-top dark:text-zinc-300"
                            >
                              {g.variety || "—"}
                            </td>
                            <td
                              rowSpan={g.listings.length}
                              className="px-3 py-2 tabular-nums align-top"
                            >
                              {g.delay}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {l.vendor_name}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <StatusBadge status={l.status} count={l.stock_count} leadTime={l.lead_time} />
                          <RestockBadge history={history[l.url]} now={now} />
                          <StaleBadge seenAt={l.seen_at} now={now} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {isBestPrice && <BestPriceTag />}
                          <span
                            className={isBestPrice ? "font-medium text-emerald-600 dark:text-emerald-400" : ""}
                          >
                            {formatPrice(l.price_cents, l.currency)}
                          </span>
                          {sig && <PriceSignalTag signal={sig} />}
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={safeHref(l.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                          >
                            view
                          </a>
                        </td>
                      </tr>,
                    );
                  });
                }
                // Sold-out motor: offer same-mount, same-cert in-stock swaps.
                const subs = substitutes[m.id];
                if (subs && subs.length > 0) {
                  rows.push(
                    <tr key={`${m.id}-subs`}>
                      <td colSpan={6} className="px-3 pb-2 pl-6">
                        <Substitutes subs={subs} />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: the table still doesn't fit, so render a stacked card
          per motor instead below the md breakpoint. */}
      <div className="mt-3 space-y-3 md:hidden">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
            {emptyMessage}
          </p>
        ) : (
          windowed.map((m) => (
            <MotorCard
              key={m.id}
              motor={m}
              showManufacturer={showManufacturer}
              snapshotTime={now}
              history={history}
              availability={availability[m.id]}
              substitutes={substitutes[m.id]}
            />
          ))
        )}
      </div>
    </>
  );
}
