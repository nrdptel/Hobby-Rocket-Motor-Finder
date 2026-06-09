import Link from "next/link";
import {
  BURN_LABEL,
  bestInStockPriceCents,
  burnCharacter,
  formatBurn,
  formatImpulse,
  formatIsp,
  formatPrice,
  formatThrust,
  isBestInStockPrice,
  listingInStock,
  manufacturerLabel,
  motorPath,
  safeHref,
  specificImpulseS,
} from "@/lib/derive";
import type { GroupedMotor, Substitute } from "@/lib/derive";
import type { CatalogAvailability } from "@/lib/history";
import type { HistorySummary } from "@/lib/snapshot";
import { unitPriceCents } from "@/lib/pack";
import { priceSignal } from "@/lib/priceSignal";
import { BestPriceTag } from "./BestPriceTag";
import { PackNote } from "./PackNote";
import { CertBadge } from "./CertBadge";
import { PriceSignalTag } from "./PriceSignalTag";
import { DiscontinuedBadge } from "./DiscontinuedBadge";
import { SparkyBadge } from "./SparkyBadge";
import { ThrustSparkline } from "./ThrustSparkline";
import { MotorAvailabilityBadge } from "./MotorAvailabilityBadge";
import { RestockBadge } from "./RestockBadge";
import { StaleBadge } from "./StaleBadge";
import { NotifyButton } from "./NotifyButton";
import { StarButton } from "./StarButton";
import { StatusBadge } from "./StatusBadge";
import { Substitutes } from "./Substitutes";

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
  history,
  availability,
  substitutes,
  sparkline,
}: {
  motor: GroupedMotor;
  showManufacturer: boolean;
  snapshotTime: Date;
  history: HistorySummary;
  availability: CatalogAvailability | undefined;
  substitutes?: Substitute[];
  /** Precomputed thrust-curve sparkline path for this motor, if any. */
  sparkline?: string;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <StarButton motorId={motor.id} designation={motor.designation} />
        <NotifyButton manufacturer={motor.manufacturer} designation={motor.designation} />
        <Link
          href={motorPath(motor)}
          className="whitespace-nowrap font-mono text-base text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:decoration-zinc-300"
          title={`${motor.designation} details, specs & all vendors`}
        >
          {motor.designation}
        </Link>
        <CertBadge impulseClass={motor.impulse_class} />
        {motor.listings.length > 0 && <DiscontinuedBadge discontinued={motor.discontinued} />}
        <SparkyBadge sparky={motor.sparky} />
        <MotorAvailabilityBadge availability={availability} discontinued={motor.discontinued} />
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {showManufacturer ? `${manufacturerLabel(motor.manufacturer)} · ` : ""}
        {motor.impulse_class} · {motor.diameter_mm}mm
        {motor.propellant ? ` · ${motor.propellant}` : ""}
        {motor.case_info
          ? ` · ${motor.case_info}`
          : motor.motor_type === "SU"
            ? " · single use"
            : ""}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 tabular-nums">
        <span>{formatImpulse(motor.total_impulse_ns)}</span>
        <span>
          {formatThrust(motor.avg_thrust_n)} · {formatBurn(motor.burn_time_s)}
        </span>
        {burnCharacter(motor) && (
          <span title="Burn character — derived from the burn duration.">
            {BURN_LABEL[burnCharacter(motor)!]}
          </span>
        )}
        {specificImpulseS(motor) != null && (
          <span title="Specific impulse — propellant efficiency (total impulse per unit propellant weight). Higher is more efficient.">
            {formatIsp(specificImpulseS(motor))} Isp
          </span>
        )}
        {sparkline && (
          <Link href={motorPath(motor)} title="Thrust curve — open for the full chart" className="inline-flex items-center">
            <ThrustSparkline d={sparkline} />
          </Link>
        )}
      </div>

      {motor.listings.length === 0 && (
        <p className="mt-2 border-t border-zinc-200 pt-2 text-xs italic text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
          Not sold by any tracked vendor{motor.discontinued ? " · out of production" : ""}.
        </p>
      )}

      <div className="mt-3 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800/80 dark:border-zinc-800/80">
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
                  const sig = priceSignal(history[l.url], l.price_cents, listingInStock(l.status));
                  return (
                    <li
                      key={`${l.vendor_slug}-${i}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-zinc-700 dark:text-zinc-300">
                          {l.vendor_name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center">
                          <StatusBadge status={l.status} count={l.stock_count} leadTime={l.lead_time} />
                          <RestockBadge history={history[l.url]} now={snapshotTime} />
                          <StaleBadge seenAt={l.seen_at} now={snapshotTime} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`tabular-nums ${isBestPrice ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}
                        >
                          {isBestPrice && <BestPriceTag />}
                          {formatPrice(unitPriceCents(l.price_cents, l.url), l.currency)}
                        </div>
                        <PackNote priceCents={l.price_cents} currency={l.currency} url={l.url} />
                        {sig && <PriceSignalTag signal={sig} />}
                        <a
                          href={safeHref(l.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
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

      {substitutes && substitutes.length > 0 && (
        <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800/80">
          <Substitutes subs={substitutes} />
        </div>
      )}
    </article>
  );
}
