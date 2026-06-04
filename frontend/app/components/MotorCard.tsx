import {
  bestInStockPriceCents,
  formatBurn,
  formatImpulse,
  formatPrice,
  formatThrust,
  isBestInStockPrice,
  manufacturerLabel,
  thrustcurveUrl,
} from "@/lib/derive";
import type { GroupedMotor } from "@/lib/derive";
import { BestPriceTag } from "./BestPriceTag";
import { StaleBadge } from "./StaleBadge";
import { StarButton } from "./StarButton";
import { StatusBadge } from "./StatusBadge";

/** Stacked, single-column rendering of one motor and its listings — the
 * narrow-screen counterpart to a row group in the desktop table. The table
 * is 13 columns wide, which only horizontal-scrolls on a phone; this is what
 * renders below the `md` breakpoint instead.
 *
 * Receives an already-grouped motor (listings collapsed by delay, sorted by
 * the active sort mode) so the card and the table show identical ordering.
 * Per-listing markers (StaleBadge, BestPriceTag) are the same shared
 * components the table uses, so the two views can't drift. */
export function MotorCard({
  motor,
  showManufacturer,
  snapshotTime,
}: {
  motor: GroupedMotor;
  showManufacturer: boolean;
  snapshotTime: Date;
}) {
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <StarButton motorId={motor.id} designation={motor.designation} />
          <a
            href={thrustcurveUrl(motor)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-base text-zinc-100 underline decoration-zinc-700 underline-offset-2 hover:decoration-zinc-300"
            title={`View ${motor.designation} on ThrustCurve.org`}
          >
            {motor.designation}
          </a>
        </div>
        <div className="text-right text-xs text-zinc-400">
          {showManufacturer && (
            <div className="text-zinc-300">{manufacturerLabel(motor.manufacturer)}</div>
          )}
          <div>
            {motor.impulse_class} · {motor.diameter_mm}mm
            {motor.propellant ? ` · ${motor.propellant}` : ""}
          </div>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 tabular-nums">
        <span>{formatImpulse(motor.total_impulse_ns)}</span>
        <span>
          {formatThrust(motor.avg_thrust_n)} · {formatBurn(motor.burn_time_s)}
        </span>
      </div>

      <div className="mt-3 divide-y divide-zinc-800/80 border-t border-zinc-800/80">
        {motor.delayGroups.map((g) => {
          const bestCents = bestInStockPriceCents(g.listings);
          return (
            <div key={g.delay} className="py-2 first:pt-2 last:pb-0">
              <div className="font-mono text-xs text-zinc-500">
                {g.variety || motor.designation}
                {g.delay !== "—" && <span> · {g.delay}</span>}
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {g.listings.map((l, i) => {
                  const isBestPrice = isBestInStockPrice(l, bestCents);
                  return (
                    <li
                      key={`${l.vendor_slug}-${i}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-zinc-300">{l.vendor_name}</div>
                        <div className="mt-0.5 flex items-center">
                          <StatusBadge status={l.status} count={l.stock_count} />
                          <StaleBadge seenAt={l.seen_at} now={snapshotTime} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`tabular-nums ${isBestPrice ? "font-medium text-emerald-400" : "text-zinc-200"}`}
                        >
                          {isBestPrice && <BestPriceTag />}
                          {formatPrice(l.price_cents, l.currency)}
                        </div>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-400 underline hover:text-zinc-100"
                        >
                          view
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </article>
  );
}
