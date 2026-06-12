import Link from "next/link";

import { type CurveSeries, ThrustCurveChart } from "./ThrustCurveChart";
import {
  BURN_LABEL,
  burnCharacter,
  cheapestInStockListing,
  formatBurn,
  formatImpulse,
  formatIsp,
  formatPrice,
  formatThrust,
  manufacturerLabel,
  motorPath,
  specificImpulseS,
} from "@/lib/derive";
import type { Motor } from "@/lib/snapshot";
import { unitPriceCents } from "@/lib/pack";

/** One motor's cheapest in-stock buy (per-unit price + vendor), or null when
 * nothing's in stock. */
function bestBuy(m: Motor): { cents: number; vendor: string; currency: string } | null {
  const l = cheapestInStockListing(m);
  if (!l) return null;
  const cents = unitPriceCents(l.price_cents, l.url);
  if (cents == null) return null;
  return { cents, vendor: l.vendor_name, currency: l.currency };
}

/** A spec row in the comparison table: a label and one cell value per motor. */
type Row = { label: string; values: (string | null)[]; title?: string };

/** Side-by-side comparison of 2–4 motors: an overlaid thrust-curve chart plus a
 * spec table (one column per motor). Server-rendered; the "remove" links just
 * drop an id from the /compare/<ids> URL, so the whole view is shareable and
 * needs no client state. */
export function CompareView({ motors, curveSeries }: { motors: Motor[]; curveSeries: CurveSeries[] }) {
  const ids = motors.map((m) => m.id);
  // A link to this same compare view with one motor removed.
  const withoutHref = (id: number) => {
    const rest = ids.filter((x) => x !== id);
    return rest.length >= 2 ? `/compare/${rest.join(",")}` : "/";
  };

  const buys = motors.map(bestBuy);
  // Cheapest in-stock price across the compared motors → highlight the winner.
  const cheapest = buys.reduce<number | null>(
    (min, b) => (b && (min == null || b.cents < min) ? b.cents : min),
    null,
  );

  const rows: Row[] = [
    { label: "Manufacturer", values: motors.map((m) => manufacturerLabel(m.manufacturer)) },
    { label: "Impulse class", values: motors.map((m) => m.impulse_class) },
    { label: "Diameter", values: motors.map((m) => `${m.diameter_mm} mm`) },
    { label: "Total impulse", values: motors.map((m) => formatImpulse(m.total_impulse_ns)) },
    { label: "Avg thrust", values: motors.map((m) => formatThrust(m.avg_thrust_n)) },
    { label: "Burn time", values: motors.map((m) => formatBurn(m.burn_time_s)) },
    {
      label: "Burn character",
      title: "Derived from the burn duration.",
      values: motors.map((m) => {
        const b = burnCharacter(m);
        return b ? BURN_LABEL[b] : null;
      }),
    },
    {
      label: "Specific impulse",
      title: "Propellant efficiency (total impulse per unit propellant weight). Higher is more efficient.",
      values: motors.map((m) => {
        const isp = specificImpulseS(m);
        return isp != null ? `${formatIsp(isp)} Isp` : null;
      }),
    },
    { label: "Propellant", values: motors.map((m) => m.propellant ?? null) },
    {
      label: "Case / type",
      values: motors.map((m) =>
        m.case_info ? m.case_info : m.motor_type === "SU" ? "Single use" : null,
      ),
    },
  ];

  return (
    <div className="mt-6">
      {curveSeries.length >= 2 ? (
        <section>
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Thrust curves</h2>
          <ThrustCurveChart series={curveSeries} className="mt-3" />
        </section>
      ) : (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          Not enough thrust-curve data to overlay these motors — the specs below still compare.
        </p>
      )}

      <section className="mt-8 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-3 py-2 text-left dark:border-zinc-800 dark:bg-zinc-950" />
              {motors.map((m) => (
                <th key={m.id} scope="col" className="px-3 py-2 text-left align-bottom">
                  <Link
                    href={motorPath(m)}
                    className="font-mono text-base text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:text-zinc-100 dark:decoration-zinc-700 dark:hover:decoration-zinc-300"
                  >
                    {m.designation}
                  </Link>
                  <Link
                    href={withoutHref(m.id)}
                    aria-label={`Remove ${m.designation} from comparison`}
                    title="Remove from comparison"
                    className="ml-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    ×
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-zinc-200 dark:border-zinc-800">
                <th
                  scope="row"
                  title={row.title}
                  className="sticky left-0 z-10 whitespace-nowrap border-t border-r border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                >
                  {row.label}
                </th>
                {row.values.map((v, i) => (
                  <td
                    key={motors[i].id}
                    className="border-t border-zinc-200 px-3 py-2 tabular-nums text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                  >
                    {v ?? <span className="text-zinc-500 dark:text-zinc-400">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {/* Cheapest in-stock buy — the winner (lowest per-unit) is emphasized. */}
            <tr className="border-t border-zinc-200 dark:border-zinc-800">
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap border-t border-r border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
              >
                Cheapest in stock
              </th>
              {buys.map((b, i) => (
                <td
                  key={motors[i].id}
                  className="border-t border-zinc-200 px-3 py-2 tabular-nums dark:border-zinc-800"
                >
                  {b ? (
                    <span
                      className={
                        cheapest != null && b.cents === cheapest
                          ? "font-medium text-emerald-700 dark:text-emerald-400"
                          : "text-zinc-800 dark:text-zinc-200"
                      }
                    >
                      {formatPrice(b.cents, b.currency)}
                      <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                        {b.vendor}
                      </span>
                    </span>
                  ) : (
                    <span className="text-zinc-500 dark:text-zinc-400">Not in stock</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
