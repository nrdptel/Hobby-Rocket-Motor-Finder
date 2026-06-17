"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  formatImpulse,
  formatPrice,
  manufacturerLabel,
  motorPath,
} from "@/lib/derive";
import type { CatalogAvailability } from "@/lib/history";
import { buildRocketLoadout, type LoadoutEntry } from "@/lib/loadout";
import type { Rocket } from "@/lib/rockets";
import type { Motor } from "@/lib/snapshot";
import { useWatchlist } from "@/lib/watchlist";
import { MotorAvailabilityBadge } from "./MotorAvailabilityBadge";
import { PackHint } from "./PackHint";
import { StarButton } from "./StarButton";

// Cap the curated "top picks" list; the full filtered catalog sits right below.
const TOP = 8;

/** The shortage hub for one of your rockets: "what can I fly in this airframe
 * right now." Shown above the results whenever a saved rocket is the active
 * filter. Lists the in-stock motors that fit (cheapest first), one-tap to add
 * them all to a Plan order — and when nothing that fits is buyable, the closest
 * in-stock swaps. The full filtered catalog stays below for the details. */
export function RocketLoadout({
  rocket,
  allMotors,
  availability,
  showManufacturer,
}: {
  rocket: Rocket;
  allMotors: Motor[];
  availability: Record<number, CatalogAvailability>;
  showManufacturer: boolean;
}) {
  const lo = useMemo(() => buildRocketLoadout(rocket, allMotors), [rocket, allMotors]);
  const { addMany } = useWatchlist();
  const [added, setAdded] = useState(false);
  // The component is keyed by rocket id (so switching rockets remounts), but
  // EDITING the same rocket keeps the id — reset the "Added" affordance when the
  // computed loadout changes so a now-different motor set is offered for adding.
  useEffect(() => setAdded(false), [lo]);

  const band =
    rocket.minImpulseNs != null && rocket.maxImpulseNs != null
      ? `${rocket.minImpulseNs}–${rocket.maxImpulseNs} N·s`
      : rocket.minImpulseNs != null
        ? `≥${rocket.minImpulseNs} N·s`
        : rocket.maxImpulseNs != null
          ? `≤${rocket.maxImpulseNs} N·s`
          : null;
  const specParts = [`${rocket.diameterMm}mm`];
  if (rocket.impulseClasses.length) specParts.push(`${rocket.impulseClasses.join("/")}-class`);
  if (rocket.caseInfos.length) specParts.push(rocket.caseInfos.join(", "));
  if (band) specParts.push(band);
  const title = rocket.name || `${rocket.diameterMm}mm rocket`;

  const inStockIds = lo.inStock.map((e) => e.motor.id);
  const shown = lo.inStock.slice(0, TOP);
  const more = lo.inStock.length - shown.length;

  return (
    <section className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800/60 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Fly it: <span className="font-mono">{title}</span>
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{specParts.join(" · ")}</span>
      </div>

      {lo.inStock.length > 0 ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            <span>
              <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
                {lo.inStock.length} in stock
              </strong>{" "}
              fit{lo.soldOutFit > 0 ? ` · ${lo.soldOutFit} sold out` : ""}
            </span>
            {added ? (
              <Link href="/plan" className="font-medium text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
                Added — plan your order →
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  addMany(inStockIds);
                  setAdded(true);
                }}
                className="rounded-full border border-emerald-400 bg-white px-2.5 py-0.5 font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
              >
                ★ Add all {lo.inStock.length} to order
              </button>
            )}
          </div>

          <ul className="mt-2 divide-y divide-emerald-200/60 dark:divide-emerald-900/40">
            {shown.map((e) => (
              <LoadoutRow
                key={e.motor.id}
                entry={e}
                availability={availability[e.motor.id]}
                showManufacturer={showManufacturer}
              />
            ))}
          </ul>
          {more > 0 && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              + {more} more that fit in the full list below.
            </p>
          )}
        </>
      ) : (
        <div className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <p>
            Nothing that fits <span className="font-mono">{title}</span> is in stock right now
            {lo.soldOutFit > 0 ? ` (${lo.soldOutFit} fit but sold out)` : ""}.
          </p>
          {lo.swaps.length > 0 ? (
            <>
              <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-200">
                Closest buyable swaps — same mount, nearest size:
              </p>
              <ul className="mt-1 divide-y divide-emerald-200/60 dark:divide-emerald-900/40">
                {lo.swaps.map((e) => (
                  <LoadoutRow
                    key={e.motor.id}
                    entry={e}
                    availability={availability[e.motor.id]}
                    showManufacturer={showManufacturer}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2">
              No same-mount motors are in stock either — tap the bell on the rocket above to get a
              restock alert.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function LoadoutRow({
  entry,
  availability,
  showManufacturer,
}: {
  entry: LoadoutEntry;
  availability: CatalogAvailability | undefined;
  showManufacturer: boolean;
}) {
  const m = entry.motor;
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <StarButton motorId={m.id} designation={m.designation} />
        <Link
          href={motorPath(m)}
          className="font-mono text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:decoration-zinc-300"
        >
          {m.designation}
        </Link>
        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {showManufacturer ? `${manufacturerLabel(m.manufacturer)} · ` : ""}
          {m.impulse_class} · {formatImpulse(m.total_impulse_ns)}
        </span>
        <MotorAvailabilityBadge availability={availability} discontinued={m.discontinued} />
      </div>
      <div className="shrink-0 text-right text-xs tabular-nums">
        {entry.cheapestCents != null ? (
          <span className="font-medium text-emerald-700 dark:text-emerald-400">
            {formatPrice(entry.cheapestCents, entry.cheapestListing?.currency ?? "USD")}
            <PackHint listing={entry.cheapestListing} />
          </span>
        ) : (
          <span className="text-zinc-400">in stock</span>
        )}
        {entry.cheapestListing?.vendor_name && (
          <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">
            {entry.cheapestListing.vendor_name}
          </span>
        )}
      </div>
    </li>
  );
}
