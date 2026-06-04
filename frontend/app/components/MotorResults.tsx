"use client";

import type { ReactNode } from "react";
import {
  bestInStockPriceCents,
  formatBurn,
  formatImpulse,
  formatPrice,
  formatThrust,
  isBestInStockPrice,
  listingInStock,
  manufacturerLabel,
  thrustcurveUrl,
} from "@/lib/derive";
import type { GroupedMotor } from "@/lib/derive";
import { useWatchlist } from "@/lib/watchlist";
import { BestPriceTag } from "./BestPriceTag";
import { MotorCard } from "./MotorCard";
import { StaleBadge } from "./StaleBadge";
import { StarButton } from "./StarButton";
import { StatusBadge } from "./StatusBadge";

/** The interactive results area: the desktop table and the mobile card list,
 * plus the watchlist overlay. It's a client component so the "starred only"
 * view is a plain array filter over the server-prepared, already-grouped
 * motors — no DOM hacks, no second source of truth. The server still does all
 * the heavy lifting (snapshot load, URL filtering, grouping) and passes plain
 * serializable data down. */
export function MotorResults({
  motors,
  showManufacturer,
  generatedAt,
  starredOnly,
}: {
  motors: GroupedMotor[];
  showManufacturer: boolean;
  generatedAt: string;
  starredOnly: boolean;
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

  // Empty-state copy depends on *why* it's empty.
  let emptyMessage = "No motors match the current filters.";
  if (applyStarred && count === 0) {
    emptyMessage = "You haven't starred any motors yet — tap the ☆ next to a motor to add it.";
  } else if (applyStarred && visible.length === 0) {
    emptyMessage = "None of your starred motors match the current filters.";
  }

  const colSpan = showManufacturer ? 13 : 12;

  return (
    <>
      <p className="mt-4 text-sm text-zinc-400">
        {visible.length} {applyStarred ? "starred " : ""}motors shown ·{" "}
        {inStockCount} with stock somewhere
      </p>

      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-3 py-2">Motor</th>
              {showManufacturer && <th className="px-3 py-2">Mfr</th>}
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Propellant</th>
              <th className="px-3 py-2">Total Impulse</th>
              <th
                className="px-3 py-2"
                title="Average thrust and burn time from the ThrustCurve catalog — useful for matching a motor to a thrust-to-weight target."
              >
                Thrust / Burn
              </th>
              <th
                className="px-3 py-2"
                title="The full vendor designation, e.g. D13-10W or H242T-14A — what the vendor actually lists the SKU as."
              >
                Variety
              </th>
              <th
                className="px-3 py-2"
                title="Ejection-charge delay time. For HPR motors, 'adj' means the delay is drilled to length at the field."
              >
                Delay
              </th>
              <th className="px-3 py-2">Vendor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-zinc-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.flatMap((m) => {
                const motorTotal = m.delayGroups.reduce(
                  (s, g) => s + g.listings.length,
                  0,
                );
                const rows: ReactNode[] = [];
                let motorIdx = 0;
                for (const g of m.delayGroups) {
                  let delayIdx = 0;
                  const bestCents = bestInStockPriceCents(g.listings);
                  for (const l of g.listings) {
                    const isBestPrice = isBestInStockPrice(l, bestCents);
                    const isMotorFirst = motorIdx === 0;
                    const isDelayFirst = delayIdx === 0;
                    const isLastInMotor = motorIdx === motorTotal - 1;
                    const trBase =
                      "hover:bg-zinc-900/60 " +
                      (isMotorFirst
                        ? "border-t-2 border-zinc-700 "
                        : isDelayFirst
                          ? "border-t border-zinc-800 "
                          : "");
                    rows.push(
                      <tr
                        key={`${m.id}-${g.delay}-${l.vendor_slug}-${delayIdx}`}
                        className={
                          trBase + (isLastInMotor ? "border-b-2 border-zinc-700" : "")
                        }
                      >
                        {isMotorFirst && (
                          <>
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              <div className="flex items-start gap-1.5">
                                <StarButton motorId={m.id} designation={m.designation} />
                                <a
                                  href={thrustcurveUrl(m)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-zinc-100 underline decoration-zinc-700 underline-offset-2 hover:decoration-zinc-300"
                                  title={`View ${m.designation} on ThrustCurve.org`}
                                >
                                  {m.designation}
                                </a>
                              </div>
                            </td>
                            {showManufacturer && (
                              <td
                                rowSpan={motorTotal}
                                className="px-3 py-2 align-top text-zinc-400 whitespace-nowrap"
                              >
                                {manufacturerLabel(m.manufacturer)}
                              </td>
                            )}
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {m.impulse_class}
                            </td>
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {`${m.diameter_mm}mm`}
                            </td>
                            <td rowSpan={motorTotal} className="px-3 py-2 align-top">
                              {m.propellant ?? "—"}
                            </td>
                            <td
                              rowSpan={motorTotal}
                              className="px-3 py-2 tabular-nums align-top"
                            >
                              {formatImpulse(m.total_impulse_ns)}
                            </td>
                            <td
                              rowSpan={motorTotal}
                              className="px-3 py-2 tabular-nums align-top whitespace-nowrap"
                            >
                              <span className="text-zinc-200">{formatThrust(m.avg_thrust_n)}</span>
                              <span className="text-zinc-500"> · {formatBurn(m.burn_time_s)}</span>
                            </td>
                          </>
                        )}
                        {isDelayFirst && (
                          <>
                            <td
                              rowSpan={g.listings.length}
                              className="px-3 py-2 font-mono text-zinc-300 align-top"
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
                        <td className="px-3 py-2 text-zinc-400">{l.vendor_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <StatusBadge status={l.status} count={l.stock_count} />
                          <StaleBadge seenAt={l.seen_at} now={now} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {isBestPrice && <BestPriceTag />}
                          <span className={isBestPrice ? "font-medium text-emerald-400" : ""}>
                            {formatPrice(l.price_cents, l.currency)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 underline hover:text-zinc-100"
                          >
                            view
                          </a>
                        </td>
                      </tr>,
                    );
                    delayIdx++;
                    motorIdx++;
                  }
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: the 13-column table only horizontal-scrolls, so render
          a stacked card per motor instead below the md breakpoint. */}
      <div className="mt-3 space-y-3 md:hidden">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-8 text-center text-sm text-zinc-400">
            {emptyMessage}
          </p>
        ) : (
          visible.map((m) => (
            <MotorCard
              key={m.id}
              motor={m}
              showManufacturer={showManufacturer}
              snapshotTime={now}
            />
          ))
        )}
      </div>
    </>
  );
}
